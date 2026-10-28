import { expect, test, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { authenticate, digest, randomToken } from '../../worker/auth';

/** Accept real calendar dates only and preserve date-only values in API metadata and storage. */
test('validates date-only token expiration and permits the current UTC date', async () => {
    const origin = 'https://lessconfig.test/api/v1';

    const login = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    const { token: admin } = await login.json<{ token: string }>();
    const headers = { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
    const today = new Date().toISOString().slice(0, 10);

    const create = (expires_at: unknown) =>
        exports.default.fetch(`${origin}/api-keys`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                name: 'Calendar expiration',
                expires_at,
                scopes: [{ project_id: '*', environment_id: '*', permission: 'read' }],
            }),
        });

    for (const date of [today, '2096-02-29', null, '']) {
        const created = await create(date);

        expect(created.status).toBe(201);

        const key = await created.json<{ id: string; token: string; expires_at: string | null }>();

        expect(key.expires_at).toBe(date || null);

        const identity = await exports.default.fetch(`${origin}/auth/me`, {
            headers: { Authorization: `Bearer ${key.token}` },
        });
        expect(identity.status).toBe(403);
        expect(await identity.json()).toEqual({
            code: 'api_token_endpoint_forbidden',
            message: 'API tokens may only access project resources and watch.',
        });

        const stored = await env.DB.prepare('SELECT expires_at FROM api_keys WHERE id = ?').bind(key.id).first();

        expect(stored).toEqual({ expires_at: date || null });
        expect(
            (
                await exports.default.fetch(`${origin}/projects`, {
                    headers: { Authorization: `Bearer ${key.token}` },
                })
            ).status,
        ).toBe(200);

        const listed = await exports.default.fetch(`${origin}/api-keys`, { headers });
        const { items } = await listed.json<{ items: { id: string; expires_at: string | null }[] }>();

        expect(items.find((item) => item.id === key.id)?.expires_at).toBe(date || null);
    }

    for (const date of [
        `${today}T23:59:00.000Z`,
        '2099-02-29',
        '2096-02-30',
        '2096-13-01',
        '2096-1-01',
        '2096/01/01',
        new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    ]) {
        const response = await create(date);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'invalid_expiration' });
    }
});

/** A date remains valid for its entire UTC day, independent of the client's local time zone. */
test('expires a token precisely when the UTC calendar date advances', async () => {
    const token = randomToken();
    const id = crypto.randomUUID();

    await env.DB.prepare('INSERT INTO api_keys (id, name, token, prefix, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, 'UTC boundary', await digest(token), token.slice(0, 8), '2096-02-29')
        .run();

    const request = new Request('https://lessconfig.test/api/v1/projects', {
        headers: { Authorization: `Bearer ${token}` },
    });

    vi.useFakeTimers({ toFake: ['Date'] });

    try {
        for (const time of ['00:00:00.000', '12:00:00.000', '23:59:59.999']) {
            vi.setSystemTime(new Date(`2096-02-29T${time}Z`));
            await expect(authenticate(request, env)).resolves.toMatchObject({ kind: 'key', id });
        }

        vi.setSystemTime(new Date('2096-03-01T00:00:00.000Z'));
        await expect(authenticate(request, env)).rejects.toMatchObject({
            status: 401,
            code: 'invalid_api_token',
        });
        await env.DB.prepare('UPDATE api_keys SET expires_at = NULL WHERE id = ?').bind(id).run();
        await expect(authenticate(request, env)).resolves.toMatchObject({ kind: 'key', id });
    } finally {
        vi.useRealTimers();
    }
});

/** API tokens must enforce resource grants, stay separate from sessions, and support deletion. */
test('issues unprefixed tokens with scoped access and deletion', async () => {
    const origin = 'https://lessconfig.test/api/v1';

    const login = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    const { token: admin } = await login.json<{ token: string }>();

    const request = (token: string, path: string, method = 'GET', data?: object) =>
        exports.default.fetch(`${origin}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: data === undefined ? undefined : JSON.stringify(data),
        });

    const slug = `tokens-${crypto.randomUUID()}`;

    const project = await (await request(admin, '/projects', 'POST', { slug, name: 'Token format' })).json<{ id: string }>();

    const created = await request(admin, '/api-keys', 'POST', {
        name: 'Application',
        scopes: [{ project_id: project.id, environment_id: '*', permission: 'read' }],
    });

    expect(created.status).toBe(201);

    const { token, id } = await created.json<{ token: string; id: string }>();

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect((await request(token, `/projects/${slug}`)).status).toBe(200);
    expect((await request(token, `/watch?scopes=${slug}`)).status).toBe(200);
    expect((await request(`${token}.${token}.${token}`, '/projects')).status).toBe(401);

    // The allowlist covers public login, unknown endpoints, and similarly named paths.
    for (const [path, method, data] of [
        ['/auth/me', 'GET'],
        ['/auth/status', 'GET'],
        ['/auth/status', 'HEAD'],
        ['/auth/logout', 'POST'],
        ['/auth/password', 'PUT', { currentPassword: 'admin', newPassword: 'must-not-change' }],
        ['/auth/login', 'POST', { username: 'admin', password: 'admin' }],
        ['/api-keys', 'GET'],
        ['/api-keys', 'POST', { name: 'Must not create', scopes: [{ project_id: '*', environment_id: '*', permission: 'write' }] }],
        [`/api-keys/${id}`, 'DELETE'],
        ['/unknown', 'GET'],
        ['/projects-other', 'GET'],
        ['/watch/extra', 'GET'],
        ['/watchers', 'GET'],
    ] as const) {
        const denied = await request(token, path, method, data);

        expect(denied.status, `${method} ${path}`).toBe(403);
        if (method === 'HEAD') {
            expect(await denied.text()).toBe('');
        } else {
            expect(await denied.json()).toEqual({
                code: 'api_token_endpoint_forbidden',
                message: 'API tokens may only access project resources and watch.',
            });
        }
        expect(denied.headers.get('Set-Cookie')).toBeNull();
    }

    // A browser cookie must not bypass the same token policy or override an explicit Bearer token.
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const denied = await exports.default.fetch(`${origin}/auth/me`, {
            method,
            headers: { Cookie: `lessconfig_session=${token}` },
        });

        expect(denied.status).toBe(403);
    }

    const cookieLogin = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { Cookie: `lessconfig_session=${token}`, Origin: 'https://lessconfig.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    expect(cookieLogin.status).toBe(403);

    const mixedCredentials = await exports.default.fetch(`${origin}/auth/me`, {
        headers: { Authorization: `Bearer ${token}`, Cookie: `lessconfig_session=${admin}` },
    });
    expect(mixedCredentials.status).toBe(403);
    expect((await request(admin, '/auth/me')).status).toBe(200);

    const list = await (await request(admin, '/api-keys')).json<{ items: Record<string, unknown>[] }>();

    const metadata = list.items.find((item) => item.id === id)!;

    expect(metadata.prefix).toBe(token.slice(0, 8));
    expect(metadata).not.toHaveProperty('token');
    expect(metadata).not.toHaveProperty('revoked_at');
    const deleted = await request(admin, `/api-keys/${id}`, 'DELETE');

    expect(deleted.status).toBe(200);
    expect(await deleted.text()).toBe('');
    expect(deleted.headers.get('Content-Type')).toBeNull();
    expect(deleted.headers.get('Cache-Control')).toBe('no-store');
    expect((await request(token, `/projects/${slug}`)).status).toBe(401);
    expect(await env.DB.prepare('SELECT id FROM api_keys WHERE id = ?').bind(id).first()).toBeNull();
    expect((await env.DB.prepare('SELECT id FROM api_key_scopes WHERE api_key_id = ?').bind(id).all()).results).toEqual([]);

    const remaining = await (await request(admin, '/api-keys')).json<{ items: { id: string }[] }>();

    expect(remaining.items.some((item) => item.id === id)).toBe(false);
    expect((await request(admin, `/api-keys/${id}`, 'DELETE')).status).toBe(404);
});

/** Global grants include future resources without granting administrative access. */
test.each(['read', 'write'] as const)(
    'enforces global %s access across existing and future projects and environments',
    async (permission) => {
        const origin = 'https://lessconfig.test/api/v1';

        const request = (token: string, path: string, method = 'GET', data?: object, headers = {}) =>
            exports.default.fetch(`${origin}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: data === undefined ? undefined : JSON.stringify(data),
            });

        const login = await exports.default.fetch(`${origin}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' }),
        });

        const { token: admin } = await login.json<{ token: string }>();
        const existingSlug = `existing-${crypto.randomUUID()}`;

        expect((await request(admin, '/projects', 'POST', { slug: existingSlug, name: 'Existing' })).status).toBe(201);
        expect((await request(admin, `/projects/${existingSlug}/environments`, 'POST', { slug: 'prod' })).status).toBe(201);

        const grant = { project_id: '*', environment_id: '*', permission };
        const created = await request(admin, '/api-keys', 'POST', { name: 'Global', scopes: [grant] });

        expect(created.status).toBe(201);

        const { token, id } = await created.json<{ token: string; id: string }>();
        const futureSlug = `future-${crypto.randomUUID()}`;

        expect((await request(admin, '/projects', 'POST', { slug: futureSlug, name: 'Future' })).status).toBe(201);

        for (const slug of [existingSlug, futureSlug]) {
            expect((await request(admin, `/projects/${slug}/environments`, 'POST', { slug: 'future' })).status).toBe(201);

            const environments = await (await request(token, `/projects/${slug}/environments`)).json<{ items: { slug: string }[] }>();

            expect(environments.items.map((item) => item.slug)).toContain('future');

            if (slug === existingSlug) {
                expect(environments.items).toHaveLength(2);
            }

            const base = `/projects/${slug}/environments/future`;

            for (const path of [
                base,
                `${base}/configurations`,
                `/watch?scopes=${slug}/future`,
                `/watch?scopes=${slug}/future&revision=0&timeout=1`,
            ]) {
                expect((await request(token, path)).status).toBe(200);
            }

            const write = await request(
                token,
                `${base}/configurations/flag`,
                'PUT',
                { value: 'YES', type: 'text' },
                {
                    'If-None-Match': '*',
                },
            );

            expect(write.status).toBe(permission === 'read' ? 403 : 201);

            if (permission === 'write') {
                const { revision } = await write.json<{ revision: number }>();

                expect(
                    (
                        await request(token, `${base}/configurations/flag`, 'DELETE', undefined, {
                            'If-Match': `"${revision}"`,
                        })
                    ).status,
                ).toBe(200);
            }

            // Edit is still limited to configuration, even with all-project access.
            expect((await request(token, base, 'DELETE')).status).toBe(403);
            expect((await request(token, `/projects/${slug}`, 'DELETE')).status).toBe(403);
            expect((await request(token, `/projects/${slug}/environments`, 'POST', { slug: 'denied' })).status).toBe(403);
        }

        const projects = await (await request(token, '/projects')).json<{ items: { slug: string }[] }>();

        expect(projects.items).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: existingSlug }), expect.objectContaining({ slug: futureSlug })]),
        );
        for (const project of projects.items) {
            expect(project).not.toHaveProperty('environment_count');
        }
        const adminProjects = await (await request(admin, '/projects')).json<{ items: object[] }>();

        for (const project of adminProjects.items) {
            expect(project).not.toHaveProperty('environment_count');
        }
        expect((await request(token, '/api-keys')).status).toBe(403);
        expect((await request(token, '/projects', 'POST', { slug: 'denied', name: 'Denied' })).status).toBe(403);
        expect((await request(admin, `/projects/${futureSlug}/environments/future`, 'DELETE')).status).toBe(200);
        expect((await request(admin, `/projects/${futureSlug}`, 'DELETE')).status).toBe(200);

        const metadata = await (await request(admin, '/api-keys')).json<{ items: { id: string; scopes: object[] }[] }>();

        expect(metadata.items.find((item) => item.id === id)?.scopes).toEqual([expect.objectContaining(grant)]);

        for (const scopes of [
            [{ ...grant, environment_id: 'specific-environment' }],
            [{ environment_id: '*', permission }],
            [{ ...grant, project_id: null }],
            [{ ...grant, environment_id: null }],
            [grant, grant],
        ]) {
            expect((await request(admin, '/api-keys', 'POST', { name: 'Invalid', scopes })).status).toBe(400);
        }

        // The schema also prevents a global project grant from targeting one environment.
        const environmentId = await env.DB.prepare(
            'SELECT e.id FROM environments e JOIN projects p ON p.id = e.project_id WHERE p.slug = ? LIMIT 1',
        )
            .bind(existingSlug)
            .first<string>('id');

        expect(environmentId).toBeTruthy();
        await expect(
            env.DB.prepare('INSERT INTO api_key_scopes (id, api_key_id, project_id, environment_id, permission) VALUES (?, ?, NULL, ?, ?)')
                .bind(crypto.randomUUID(), id, environmentId, permission)
                .run(),
        ).rejects.toThrow(/CHECK constraint failed/);
    },
);

/** Large scope sets must be validated and persisted completely without a business count limit. */
test('creates more than fifty grants and preserves resource ownership and cascading deletion', async () => {
    const origin = 'https://lessconfig.test/api/v1';

    const login = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    const { token: admin } = await login.json<{ token: string }>();
    const projectId = crypto.randomUUID();
    const slug = `many-scopes-${projectId}`;
    const environmentIds = Array.from({ length: 125 }, () => crypto.randomUUID());

    await env.DB.batch([
        env.DB.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').bind(projectId, slug, 'Many scopes'),
        env.DB.prepare(
            `INSERT INTO environments (id, project_id, slug)
      SELECT value, ?, 'env-' || key FROM json_each(?)`,
        ).bind(projectId, JSON.stringify(environmentIds)),
    ]);

    const scopes = environmentIds.map((id) => ({
        project_id: projectId,
        environment_id: id,
        permission: 'read',
    }));

    const create = (grants: object[]) =>
        exports.default.fetch(`${origin}/api-keys`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Many scopes', scopes: grants }),
        });

    const response = await create(scopes);

    expect(response.status).toBe(201);

    const key = await response.json<{ id: string; token: string; scopes: object[] }>();

    expect(key.scopes).toEqual(scopes);

    const listed = await exports.default.fetch(`${origin}/projects/${slug}/environments`, {
        headers: { Authorization: `Bearer ${key.token}` },
    });

    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ total: 125 });

    const invalid = await create([...scopes.slice(0, -1), { ...scopes.at(-1), environment_id: 'unrelated' }]);

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'invalid_scope_environment' });
    await env.DB.prepare('DELETE FROM environments WHERE id = ?').bind(environmentIds[0]).run();

    const metadata = await exports.default.fetch(`${origin}/api-keys`, {
        headers: { Authorization: `Bearer ${admin}` },
    });

    const { items } = await metadata.json<{
        items: { id: string; scopes: { environment_id: string }[] }[];
    }>();

    const remaining = items.find((item) => item.id === key.id)!.scopes;

    expect(remaining).toHaveLength(124);
    expect(remaining.every((scope) => scope.environment_id !== '*' && scope.environment_id !== environmentIds[0])).toBe(true);
});
