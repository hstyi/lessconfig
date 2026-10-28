import { beforeAll, expect, test, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { createScheduledController, runInDurableObject } from 'cloudflare:test';
import worker from '../../worker';
import type { Config, Scope } from '../../worker/common';
import type { WatchResult } from '../../worker/watch';

const origin = 'https://lessconfig.test/api/v1';
let admin: string;

/** Authenticate against the isolated test database once for this suite. */
beforeAll(async () => {
    const response = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    expect(response.status).toBe(200);
    admin = (await response.json<{ token: string }>()).token;
});

/**
 * Dispatch an authenticated request through the real Worker.
 * @param path - The versioned API resource suffix.
 * @param init - Optional HTTP method, body, headers, or cancellation signal.
 * @param token - The administrator or scoped token credential.
 * @returns The unconsumed response.
 */
function request(path: string, init: RequestInit = {}, token = admin) {
    const headers = new Headers(init.headers);

    headers.set('Authorization', `Bearer ${token}`);

    if (init.body) {
        headers.set('Content-Type', 'application/json');
    }

    return exports.default.fetch(`${origin}${path}`, { ...init, headers });
}

/**
 * Encode repeated scope parameters without an arbitrary scope count limit.
 * @param scopes - Public paths to read or observe.
 * @returns The URL query string.
 */
function query(scopes: string[]) {
    return new URLSearchParams(scopes.map((scope) => ['scopes', scope])).toString();
}

/** Create two projects with two environments each, keeping fixtures independent. */
async function seed() {
    const a = `watch-a-${crypto.randomUUID()}`;
    const b = `watch-b-${crypto.randomUUID()}`;
    const statements: D1PreparedStatement[] = [];

    for (const project of [a, b]) {
        statements.push(env.DB.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').bind(project, project, project));

        for (const environment of ['prod', 'dev']) {
            statements.push(
                env.DB.prepare('INSERT INTO environments (id, project_id, slug) VALUES (?, ?, ?)').bind(
                    `${project}-${environment}`,
                    project,
                    environment,
                ),
            );
        }
    }

    await env.DB.batch(statements);

    return { a, b };
}

/**
 * Initialize watch before reading configuration through the environment resource.
 * @param scopes - Public paths covered by the subscription.
 * @param token - The administrator or scoped token credential.
 * @returns The current global position without historical changes.
 */
async function initialize(scopes: string[], token = admin) {
    const response = await request(`/watch?${query(scopes)}`, {}, token);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const result = await response.json<WatchResult>();

    expect(result.changes).toEqual([]);

    return result;
}

/**
 * Issue a credential through the public API to exercise persisted authorization rules.
 * @param scopes - Project and environment grants, including wildcard grants.
 * @returns The token identity and its one-time secret.
 */
async function createToken(scopes: Scope[]) {
    const response = await request('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'wildcard watch', scopes }),
    });

    expect(response.status).toBe(201);

    return response.json<{ id: string; token: string }>();
}

/**
 * Read complete values from an existing environment endpoint.
 * @param scope - The project/environment path to read.
 * @returns The environment's configuration list, independent of watch progress.
 */
async function readEnvironment(scope: string) {
    const [project, environment] = scope.split('/');
    const response = await request(`/projects/${project}/environments/${environment}/configurations`);

    expect(response.status).toBe(200);

    const result = await response.json<{ items: Config[]; total: number }>();

    expect(result).not.toHaveProperty('revision');

    return result;
}

/**
 * Save a configuration through its public conditional-write endpoint.
 * @param scope - The project/environment path.
 * @param key - The configuration name.
 * @param value - The raw text content.
 * @param revision - Existing configuration revision; omission creates a new key.
 * @returns The successfully persisted configuration.
 */
async function put(scope: string, key: string, value: string, revision?: number) {
    const [project, environment] = scope.split('/');
    const response = await request(`/projects/${project}/environments/${environment}/configurations/${key}`, {
        method: 'PUT',
        headers: revision === undefined ? { 'If-None-Match': '*' } : { 'If-Match': `"${revision}"` },
        body: JSON.stringify({ value, type: 'text' }),
    });

    expect(response.status).toBe(revision === undefined ? 201 : 200);

    return response.json<Config>();
}

/**
 * Start a real GET long poll.
 * @param scopes - Public ranges to observe.
 * @param revision - Last applied global position.
 * @param timeout - Maximum wait in seconds.
 * @param token - Optional scoped credential.
 * @returns The eventual public response.
 */
function watch(scopes: string[], revision: number, timeout = 1, token = admin) {
    return request(`/watch?${query(scopes)}&revision=${revision}&timeout=${timeout}`, {}, token);
}

/** Wait for registration without relying on arbitrary network timing. */
async function registered() {
    await vi.waitFor(async () => {
        const count = await runInDurableObject(env.WATCH.getByName('global'), (instance) => {
            const waiters = Reflect.get(instance, 'waiters') as Map<string, unknown>;

            return waiters.size;
        });

        expect(count).toBeGreaterThan(0);
    });
}

test.each(['administrator', 'global token'])(
    '%s wildcard initializes and observes projects created during a long poll',
    async (identity) => {
        const token =
            identity === 'administrator'
                ? admin
                : (await createToken([{ project_id: '*', environment_id: '*', permission: 'read' }])).token;
        const initial = await initialize(['*'], token);

        expect(
            await runInDurableObject(
                env.WATCH.getByName('global'),
                (instance) => (Reflect.get(instance, 'waiters') as Map<string, unknown>).size,
            ),
        ).toBe(0);

        const pending = watch(['*'], initial.revision, 5, token);

        await registered();
        const { a, b } = await seed();
        const saved = await put(`${a}/prod`, 'future', 'new project');
        const response = await pending;

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            revision: saved.revision,
            changes: [{ revision: saved.revision, project: a, environment: 'prod', key: 'future', resource: 'config', type: 'created' }],
        });

        const another = await put(`${b}/dev`, 'other', 'another project');
        const caughtUp = await watch(['*'], saved.revision, 5, token);

        expect((await caughtUp.json<WatchResult>()).changes).toMatchObject([
            { revision: another.revision, project: b, environment: 'dev' },
        ]);
    },
);

test('wildcard uses the union of readable grants without exposing other environments or projects', async () => {
    const { a, b } = await seed();
    const credential = await createToken([
        { project_id: a, environment_id: `${a}-prod`, permission: 'read' },
        { project_id: b, environment_id: '*', permission: 'write' },
        { project_id: b, environment_id: `${b}-prod`, permission: 'read' },
    ]);
    const initial = await initialize(['*'], credential.token);
    const first = await put(`${a}/prod`, 'readable', 'read grant');
    const second = await put(`${b}/prod`, 'editable', 'overlapping grants');

    await put(`${a}/dev`, 'secret', 'outside granted environments');
    const unrelated = await seed();
    const ignored = await put(`${unrelated.a}/prod`, 'secret', 'outside granted projects');
    const response = await watch(['*'], initial.revision, 5, credential.token);
    const result = await response.json<WatchResult>();

    expect(response.status).toBe(200);
    expect(result.revision).toBe(ignored.revision);
    expect(result.changes.map((change) => change.revision)).toEqual([first.revision, second.revision]);

    for (const scopes of [[a], [`${a}/dev`], [`${a}/prod`, `${unrelated.a}/prod`]]) {
        expect((await request(`/watch?${query(scopes)}`, {}, credential.token)).status).toBe(403);
        expect((await watch(scopes, result.revision, 1, credential.token)).status).toBe(403);
    }

    const later = await put(`${a}/dev`, 'unrelated', 'must not be returned');
    const timeout = await watch(['*'], result.revision, 1, credential.token);

    expect(timeout.status).toBe(200);
    expect(await timeout.json()).toEqual({ revision: later.revision, changes: [] });
});

test('wildcard matches future environments only where the credential has an all-environments grant', async () => {
    const { a, b } = await seed();
    const credential = await createToken([
        { project_id: a, environment_id: `${a}-prod`, permission: 'read' },
        { project_id: b, environment_id: '*', permission: 'read' },
    ]);
    const initial = await initialize(['*'], credential.token);
    let finished = false;
    const pending = watch(['*'], initial.revision, 5, credential.token).then((response) => {
        finished = true;

        return response;
    });

    await registered();
    for (const project of [a, b]) {
        expect(
            (
                await request(`/projects/${project}/environments`, {
                    method: 'POST',
                    body: JSON.stringify({ slug: 'future' }),
                })
            ).status,
        ).toBe(201);
    }

    await put(`${a}/future`, 'secret', 'not granted');
    expect(finished).toBe(false);

    const saved = await put(`${b}/future`, 'allowed', 'covered by the project grant');
    const response = await pending;

    expect(response.status).toBe(200);
    expect((await response.json<WatchResult>()).changes).toEqual([
        { revision: saved.revision, project: b, environment: 'future', key: 'allowed', resource: 'config', type: 'created' },
    ]);
});

test.each(['deleted', 'expired', 'reduced'])('wildcard reauthorizes a pending response after credentials are %s', async (change) => {
    const { a, b } = await seed();
    const credential = await createToken([
        { project_id: a, environment_id: '*', permission: 'read' },
        { project_id: b, environment_id: `${b}-prod`, permission: 'read' },
    ]);
    const initial = await initialize(['*'], credential.token);
    const pending = watch(['*'], initial.revision, 5, credential.token);

    await registered();
    if (change === 'deleted') {
        expect((await request(`/api-keys/${credential.id}`, { method: 'DELETE' })).status).toBe(200);
    } else if (change === 'expired') {
        await env.DB.prepare("UPDATE api_keys SET expires_at = '2000-01-01' WHERE id = ?").bind(credential.id).run();
    } else {
        await env.DB.prepare('DELETE FROM api_key_scopes WHERE api_key_id = ? AND project_id = ?').bind(credential.id, a).run();
    }

    await put(`${a}/prod`, 'secret', 'must not be disclosed after revocation');
    const response = await pending;

    expect(response.status).toBe(change === 'reduced' ? 403 : 401);
    expect(await response.json()).not.toHaveProperty('changes');

    if (change === 'reduced') {
        const next = await initialize(['*'], credential.token);
        const allowed = await put(`${b}/prod`, 'remaining', 'still authorized');

        expect((await (await watch(['*'], next.revision, 1, credential.token)).json<WatchResult>()).changes).toMatchObject([
            { revision: allowed.revision, project: b, key: 'remaining' },
        ]);
    }
});

test('wildcard rejects unauthenticated credentials and credentials with no readable grants', async () => {
    expect((await exports.default.fetch(`${origin}/watch?scopes=*`)).status).toBe(401);

    const { a } = await seed();
    const credential = await createToken([{ project_id: a, environment_id: `${a}-prod`, permission: 'read' }]);

    await env.DB.prepare('DELETE FROM api_key_scopes WHERE api_key_id = ?').bind(credential.id).run();
    expect((await request('/watch?scopes=*', {}, credential.token)).status).toBe(403);
    expect((await watch(['*'], 0, 1, credential.token)).status).toBe(403);
});

test('global wildcard retains parent deletion events after their rows are removed', async () => {
    const { a, b } = await seed();
    const credential = await createToken([{ project_id: '*', environment_id: '*', permission: 'read' }]);
    const initial = await initialize(['*'], credential.token);
    const pending = watch(['*'], initial.revision, 5, credential.token);

    await registered();
    expect((await request(`/projects/${a}/environments/prod`, { method: 'DELETE' })).status).toBe(200);
    const first = await (await pending).json<WatchResult>();

    expect(first.changes).toMatchObject([{ project: a, environment: 'prod', resource: 'environment', type: 'deleted' }]);

    for (const environment of ['prod', 'dev']) {
        expect((await request(`/projects/${b}/environments/${environment}`, { method: 'DELETE' })).status).toBe(200);
    }
    expect((await request(`/projects/${b}`, { method: 'DELETE' })).status).toBe(200);

    const result = await (await watch(['*'], first.revision, 5, credential.token)).json<WatchResult>();

    expect(result.changes).toHaveLength(3);
    expect(result.changes.at(-1)).toMatchObject({ project: b, environment: null, key: null, resource: 'project', type: 'deleted' });
});

test('omitting revision initializes immediately while explicit zero reads available history', async () => {
    const { a } = await seed();
    const scope = `${a}/prod`;
    const saved = await put(scope, 'existing', 'before initialization');
    const response = await request(`/watch?${query([scope])}&timeout=300`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ revision: saved.revision, changes: [] });
    expect(
        await runInDurableObject(
            env.WATCH.getByName('global'),
            (instance) => (Reflect.get(instance, 'waiters') as Map<string, unknown>).size,
        ),
    ).toBe(0);

    const fromZero = await watch([scope], 0, 300);

    expect((await fromZero.json<WatchResult>()).changes).toMatchObject([{ key: 'existing', revision: saved.revision }]);
    expect((await exports.default.fetch(`${origin}/watch?${query([scope])}`)).status).toBe(401);
    expect((await request(`/watch?${query([`${a}/missing`])}`)).status).toBe(404);
    expect((await request(`/watch?${query(['missing-project'])}`)).status).toBe(404);
}, 3000);

test('initialization preserves changes during separate environment reads and before the first long poll', async () => {
    const { a, b } = await seed();
    const scopes = [`${a}/prod`, `${b}/prod`];
    const first = await put(scopes[0], 'flag', 'A before');
    const second = await put(scopes[1], 'flag', 'B before');
    const initial = await initialize(scopes);

    expect((await readEnvironment(scopes[0])).items[0].value).toBe('A before');

    const duringRead = await put(scopes[0], 'flag', 'A after', first.revision);

    expect((await readEnvironment(scopes[1])).items[0].value).toBe('B before');

    const beforePoll = await put(scopes[1], 'flag', 'B after', second.revision);
    const result = await (await watch(scopes, initial.revision, 300)).json<WatchResult>();

    expect(result.changes.map((change) => change.revision)).toEqual([duringRead.revision, beforePoll.revision]);
    expect((await readEnvironment(scopes[0])).items[0].value).toBe('A after');
    expect((await readEnvironment(scopes[1])).items[0].value).toBe('B after');
}, 3000);

test('one revision covers mixed projects, environments, and keys without duplicate results', async () => {
    const { a, b } = await seed();
    const scopes = [a, `${a}/prod`, `${a}/prod/one`, `${b}/prod`, `${b}/dev/selected`, a];
    const initial = await initialize(scopes);
    const saved = [];

    saved.push(await put(`${a}/prod`, 'one', 'A'));
    saved.push(await put(`${a}/dev`, 'two', 'B'));
    saved.push(await put(`${b}/prod`, 'three', 'C'));
    saved.push(await put(`${b}/dev`, 'selected', 'D'));
    const ignored = await put(`${b}/dev`, 'ignored', 'E');

    expect(new Set(saved.map((item) => item.revision)).size).toBe(4);
    expect(saved.map((item) => item.revision)).toEqual([...saved.map((item) => item.revision)].sort((left, right) => left - right));

    const response = await watch(scopes, initial.revision);
    const result = await response.json<WatchResult>();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(result.revision).toBe(ignored.revision);
    expect(result.changes.map((change) => change.key)).toEqual(['one', 'two', 'three', 'selected']);
    expect(result).not.toHaveProperty('cursor');
    expect((await readEnvironment(`${a}/prod`)).items).toMatchObject([{ key: 'one', value: 'A' }]);
    expect((await readEnvironment(`${b}/dev`)).items).toMatchObject([
        { key: 'selected', value: 'D' },
        { key: 'ignored', value: 'E' },
    ]);
});

test('unrelated changes stay suspended while a matching key wakes the GET request', async () => {
    const { a, b } = await seed();
    const scopes = [`${a}/prod/flag`];
    const initial = await initialize(scopes);
    let finished = false;
    const pending = watch(scopes, initial.revision, 5).then((response) => {
        finished = true;

        return response;
    });

    await registered();
    await put(`${b}/prod`, 'flag', 'unrelated project');
    await put(`${a}/prod`, 'different', 'unrelated key');
    expect(finished).toBe(false);

    const matching = await put(`${a}/prod`, 'flag', 'match');
    const result = await (await pending).json<WatchResult>();

    expect(result.revision).toBe(matching.revision);
    expect(result.changes).toMatchObject([{ project: a, environment: 'prod', key: 'flag', type: 'created' }]);
    expect(result.changes).toHaveLength(1);

    const unrelated = await put(`${b}/dev`, 'later', 'ignored');
    const timeout = await watch(scopes, result.revision);

    expect(await timeout.json()).toEqual({ revision: unrelated.revision, changes: [] });
});

test('changes after initialization are returned immediately, including future environments', async () => {
    const { a } = await seed();
    const initial = await initialize([a]);
    const created = await request(`/projects/${a}/environments`, {
        method: 'POST',
        body: JSON.stringify({ slug: 'future' }),
    });

    expect(created.status).toBe(201);
    const config = await put(`${a}/future`, 'new.yml', 'ready');
    const result = await (await watch([a], initial.revision, 5)).json<WatchResult>();

    expect(result.revision).toBe(config.revision);
    expect(result.changes).toMatchObject([{ environment: 'future', key: 'new.yml' }]);
}, 3000);

test('deletion and restore remain observable and repeated edits coalesce to the latest change', async () => {
    const { a } = await seed();
    const scope = `${a}/prod`;
    const base = `/projects/${a}/environments/prod`;
    const first = await put(scope, 'flag', 'original');
    const updated = await put(scope, 'flag', 'updated', first.revision);
    const again = await put(scope, 'flag', 'latest', updated.revision);
    const merged = await (await watch([scope], first.revision)).json<WatchResult>();

    expect(merged.changes).toHaveLength(1);
    expect(merged.changes[0]).toMatchObject({ revision: again.revision, type: 'updated' });

    const removed = await request(`${base}/configurations/flag`, {
        method: 'DELETE',
        headers: { 'If-Match': `"${again.revision}"` },
    });
    const deleted = await removed.json<{ revision: number }>();

    expect(removed.status).toBe(200);
    expect((await readEnvironment(scope)).items).toEqual([]);
    expect((await (await watch([`${scope}/flag`], again.revision)).json<WatchResult>()).changes[0].type).toBe('deleted');

    const history = await (await request(`${base}/configurations/flag/history`)).json<{ items: { id: string }[] }>();
    const restored = await request(`${base}/configurations/flag/history/${history.items.at(-1)!.id}/restore`, {
        method: 'POST',
        headers: { 'If-None-Match': '*' },
    });

    expect(restored.status).toBe(201);
    expect((await restored.json<Config>()).value).toBe('original');
    expect((await (await watch([scope], deleted.revision)).json<WatchResult>()).changes[0].type).toBe('restored');
});

test('resource tombstones survive history cascades and same-name environment recreation', async () => {
    const { a } = await seed();
    const scope = `${a}/prod`;
    const base = `/projects/${a}/environments/prod`;
    const config = await put(scope, 'gone', 'old');

    await request(`${base}/configurations/gone`, {
        method: 'DELETE',
        headers: { 'If-Match': `"${config.revision}"` },
    });

    const before = await initialize([scope]);
    const pending = watch([scope], before.revision, 5);

    await registered();
    expect((await request(base, { method: 'DELETE' })).status).toBe(200);
    expect((await (await pending).json<WatchResult>()).changes).toMatchObject([{ resource: 'environment', type: 'deleted', key: null }]);

    const history = await env.DB.prepare('SELECT COUNT(*) AS count FROM config_history WHERE environment_id = ?')
        .bind(`${a}-prod`)
        .first<{ count: number }>();

    expect(history!.count).toBe(0);
    expect(
        (
            await request(`/projects/${a}/environments`, {
                method: 'POST',
                body: JSON.stringify({ slug: 'prod' }),
            })
        ).status,
    ).toBe(201);
    const recreated = await put(scope, 'gone', 'new');
    const changes = await (await watch([a], before.revision)).json<WatchResult>();

    expect(changes.revision).toBe(recreated.revision);
    expect(changes.changes.map((change) => change.resource)).toEqual(['environment', 'config']);
    expect((await readEnvironment(scope)).items[0].value).toBe('new');
});

test('project deletion wakes project subscribers and its event survives the deleted row', async () => {
    const project = `empty-${crypto.randomUUID()}`;

    await request('/projects', {
        method: 'POST',
        body: JSON.stringify({ slug: project, name: project }),
    });

    const before = await initialize([project]);
    const pending = watch([project], before.revision, 5);

    await registered();
    expect((await request(`/projects/${project}`, { method: 'DELETE' })).status).toBe(200);

    const result = await (await pending).json<WatchResult>();

    expect(result.changes).toMatchObject([{ resource: 'project', project, environment: null, key: null, type: 'deleted' }]);
    expect(await env.DB.prepare('SELECT revision FROM watch_changes WHERE project_slug = ?').bind(project).first()).not.toBeNull();
});

test('no-op and rejected writes preserve the clock, and D1 failures roll back notifications with data', async () => {
    const { a } = await seed();
    const scope = `${a}/prod`;
    const original = await put(scope, 'flag', 'original');

    expect((await put(scope, 'flag', 'original', original.revision)).revision).toBe(original.revision);

    const base = `/projects/${a}/environments/prod/configurations`;
    const rejected = await request(`${base}/flag`, {
        method: 'PUT',
        headers: { 'If-Match': '"0"' },
        body: JSON.stringify({ value: 'stale', type: 'text' }),
    });

    expect(rejected.status).toBe(409);
    expect((await initialize([scope])).revision).toBe(original.revision);

    await env.DB.exec(
        "CREATE TRIGGER reject_watch_test BEFORE INSERT ON config_history WHEN NEW.key = 'atomic-failure' BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
    );

    try {
        const failed = await request(`${base}/atomic-failure`, {
            method: 'PUT',
            headers: { 'If-None-Match': '*' },
            body: JSON.stringify({ value: 'must roll back', type: 'text' }),
        });

        expect(failed.status).toBe(500);
        expect((await initialize([scope])).revision).toBe(original.revision);
        expect((await readEnvironment(scope)).items.some((item) => item.key === 'atomic-failure')).toBe(false);
        expect(
            await env.DB.prepare("SELECT revision FROM watch_changes WHERE project_id = ? AND config_key = 'atomic-failure'")
                .bind(a)
                .first(),
        ).toBeNull();
    } finally {
        await env.DB.exec('DROP TRIGGER reject_watch_test');
    }

    expect((await put(scope, 'after-failure', 'works')).revision).toBe(original.revision + 1);
});

test('validates the entire requested range and rechecks grants before releasing a pending result', async () => {
    const { a, b } = await seed();
    const scope = `${a}/prod`;
    const tokenResponse = await request('/api-keys', {
        method: 'POST',
        body: JSON.stringify({
            name: 'watch only prod',
            scopes: [{ project_id: a, environment_id: `${a}-prod`, permission: 'read' }],
        }),
    });
    const credential = await tokenResponse.json<{ id: string; token: string }>();
    const initial = await initialize([scope]);

    for (const scopes of [[a], [scope, `${b}/prod`]]) {
        expect((await watch(scopes, initial.revision, 1, credential.token)).status).toBe(403);
        expect((await request(`/watch?${query(scopes)}`, {}, credential.token)).status).toBe(403);
    }

    expect((await request(`/watch?${query([`${scope}/not-yet-created`])}`, {}, credential.token)).status).toBe(200);

    const pending = watch([scope], initial.revision, 5, credential.token);

    await registered();
    await env.DB.prepare('DELETE FROM api_key_scopes WHERE api_key_id = ?').bind(credential.id).run();
    await put(scope, 'flag', 'do not disclose');
    expect((await pending).status).toBe(403);
});

test('scheduled retention expires old revisions independently of writes without removing configuration history', async () => {
    const { a } = await seed();
    const scope = `${a}/prod`;
    const before = await initialize([scope]);
    const old = await put(scope, 'old', 'retained value');

    await env.DB.prepare('UPDATE watch_changes SET created_at = ? WHERE revision <= ?')
        .bind('2000-01-01T00:00:00.000Z', old.revision)
        .run();

    const latest = await put(scope, 'new', 'current');

    expect(await env.DB.prepare('SELECT revision FROM watch_changes WHERE revision = ?').bind(old.revision).first()).not.toBeNull();
    expect((await watch([scope], before.revision)).status).toBe(200);

    await worker.scheduled(createScheduledController({ scheduledTime: new Date(), cron: '0 0 */3 * *' }), env);

    const expired = await watch([scope], before.revision);

    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ code: 'revision_expired' });
    expect(await env.DB.prepare('SELECT revision FROM watch_changes WHERE revision = ?').bind(old.revision).first()).toBeNull();
    expect((await readEnvironment(scope)).items).toHaveLength(2);
    expect((await initialize([scope])).revision).toBe(latest.revision);
    expect((await watch([scope], old.revision)).status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM config_history WHERE environment_id = ?').bind(`${a}-prod`).first()).toEqual(
        {
            count: 2,
        },
    );

    const ahead = await watch([scope], latest.revision + 1);

    expect(ahead.status).toBe(409);
    expect(await ahead.json()).toMatchObject({ code: 'revision_ahead' });
    expect((await put(scope, 'after-cleanup', 'next revision')).revision).toBe(latest.revision + 1);
});

test('accepts more than fifty scopes and rejects malformed parameters or unsupported methods', async () => {
    const { a } = await seed();
    const scope = `${a}/prod`;
    const scopes = Array.from({ length: 75 }, (_, index) => `${scope}/flag-${index}`);
    const initial = await initialize(scopes);
    const written = await put(scope, 'flag-74', 'found');

    expect((await (await watch(scopes, initial.revision)).json<WatchResult>()).changes).toMatchObject([
        { revision: written.revision, key: 'flag-74' },
    ]);

    for (const suffix of [
        'revision=0',
        `scopes=${scope}&revision=`,
        `scopes=${scope}&timeout=0`,
        `scopes=${scope}&timeout=1&timeout=2`,
        `scopes=${scope}&revision=-1`,
        `scopes=${scope}&revision=1.5`,
        `scopes=${scope}&revision=9007199254740992`,
        `scopes=${scope}&revision=0&revision=1`,
        `scopes=${scope}&revision=0&timeout=0`,
        `scopes=${scope}&revision=0&timeout=301`,
        `scopes=${scope}/key/extra&revision=0`,
        `scopes=${a}//flag&revision=0`,
        `scopes=*&scopes=${scope}`,
        'scopes=*&scopes=*',
        `scopes=*&scopes=${scope}&revision=0`,
        'scopes=*/prod',
        `scopes=${a}/*`,
        `scopes=${scope}/*`,
    ]) {
        expect((await request(`/watch?${suffix}`)).status).toBe(400);
    }

    expect((await request(`/watch?${query([scope])}&revision=0`, { method: 'POST' })).status).toBe(405);
    expect((await request(`/watch?${query([scope])}&revision=0`, { method: 'HEAD' })).status).toBe(405);
    expect((await request(`/projects/${a}/environments/prod/watch?since=0`)).status).toBe(404);
    expect((await request(`/projects/${a}/environments/prod/snapshot`)).status).toBe(404);
    expect((await request(`/configurations?${query([scope])}`)).status).toBe(404);
    expect((await request(`/watch?${query([scope])}`, { method: 'HEAD' })).status).toBe(405);
    expect((await request(`/watch?${query([scope])}`, { method: 'POST' })).status).toBe(405);
});

test('canceling a GET removes its coordinator waiter and permits a clean reconnect', async () => {
    const { a } = await seed();
    const scope = `${a}/prod`;
    const initial = await initialize([scope]);
    const controller = new AbortController();
    const pending = request(`/watch?${query([scope])}&revision=${initial.revision}&timeout=5`, {
        signal: controller.signal,
    }).catch(() => null);

    await registered();
    controller.abort();
    await pending;
    await vi.waitFor(async () => {
        const count = await runInDurableObject(env.WATCH.getByName('global'), (instance) => {
            const waiters = Reflect.get(instance, 'waiters') as Map<string, unknown>;

            return waiters.size;
        });

        expect(count).toBe(0);
    });

    const written = await put(scope, 'after-abort', 'ready');

    expect((await (await watch([scope], initial.revision)).json<WatchResult>()).revision).toBe(written.revision);
});

test('a pending response accounts for every scope up to its returned watermark', async () => {
    const { a, b } = await seed();
    const scopes = [`${a}/prod`, `${b}/dev`];
    const initial = await initialize(scopes);
    const pending = watch(scopes, initial.revision, 5);

    await registered();

    const writes = await Promise.all(
        Array.from({ length: 8 }, (_, index) => put(scopes[index % scopes.length], `concurrent-${index}`, String(index))),
    );
    const result = await (await pending).json<WatchResult>();
    const committed = await env.DB.prepare(
        'SELECT revision FROM watch_changes WHERE project_id IN (?, ?) AND revision > ? AND revision <= ? ORDER BY revision',
    )
        .bind(a, b, initial.revision, result.revision)
        .all<{ revision: number }>();

    expect(result.changes.map((change) => change.revision)).toEqual(committed.results.map((change) => change.revision));

    const latest = Math.max(...writes.map((config) => config.revision));
    const remaining = result.revision === latest ? [] : (await (await watch(scopes, result.revision)).json<WatchResult>()).changes;

    expect(new Set([...result.changes, ...remaining].map((change) => change.key)).size).toBe(8);
});
