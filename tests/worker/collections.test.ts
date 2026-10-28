import { expect, test } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

/** The initial schema keeps accounts in D1 and sessions in KV without resetting credentials. */
test('initializes one user and preserves credentials when migrations run again', async () => {
    expect(env.TEST_MIGRATIONS).toHaveLength(1);
    await applyD1Migrations(env.MIGRATION_DB, env.TEST_MIGRATIONS);
    expect((await env.MIGRATION_DB.prepare('SELECT id, username, role, default_password FROM users').all()).results).toEqual([
        { id: 1, username: 'admin', role: 'admin', default_password: 1 },
    ]);
    expect(
        await env.MIGRATION_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'administrator'").first(),
    ).toBeNull();
    expect(await env.MIGRATION_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").first()).toBeNull();
    const columns = await env.MIGRATION_DB.prepare('PRAGMA table_info(users)').all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).not.toContain('session_version');
    await env.MIGRATION_DB.batch([
        env.MIGRATION_DB.prepare("UPDATE users SET password_hash = 'changed-verifier', default_password = 0 WHERE id = 1"),
        env.MIGRATION_DB.prepare(
            "INSERT INTO api_keys (id, name, token, prefix) VALUES ('existing-key', 'Existing', 'existing-digest', 'existing')",
        ),
    ]);
    await applyD1Migrations(env.MIGRATION_DB, env.TEST_MIGRATIONS);
    expect(await env.MIGRATION_DB.prepare('SELECT password_hash, default_password FROM users WHERE id = 1').first()).toEqual({
        password_hash: 'changed-verifier',
        default_password: 0,
    });
    expect(await env.MIGRATION_DB.prepare("SELECT token FROM api_keys WHERE id = 'existing-key'").first('token')).toBe('existing-digest');
    expect((await env.MIGRATION_DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

/** Every collection exceeds the former maximum page size without losing access filtering. */
test('returns complete collections and preserves scoped permissions', async () => {
    const origin = 'https://lessconfig.test/api/v1';

    const login = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    expect(login.status).toBe(200);

    const { token } = await login.json<{ token: string }>();
    const prefix = crypto.randomUUID();
    const projectId = `${prefix}-project-0`;
    const environmentId = `${prefix}-env-0`;
    const projectSlug = `all-${prefix}`;
    const count = 205;

    await env.DB.batch(
        Array.from({ length: count }, (_, index) =>
            env.DB.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').bind(
                `${prefix}-project-${index}`,
                index === 0 ? projectSlug : `${projectSlug}-${index}`,
                `Project ${index}`,
            ),
        ),
    );
    await env.DB.batch(
        Array.from({ length: count }, (_, index) =>
            env.DB.prepare('INSERT INTO environments (id, project_id, slug, description) VALUES (?, ?, ?, ?)').bind(
                `${prefix}-env-${index}`,
                projectId,
                `env-${index}`,
                `Environment ${index}`,
            ),
        ),
    );
    await env.DB.batch(
        Array.from({ length: count }, (_, index) =>
            env.DB.prepare(
                "INSERT INTO config_entries (environment_id, key, value, type, revision, updated_at) VALUES (?, ?, 'YES', 'text', ?, '2026-01-01')",
            ).bind(environmentId, `config-${index}`, index + 1),
        ),
    );
    await env.DB.batch(
        Array.from({ length: count }, (_, index) =>
            env.DB.prepare(
                "INSERT INTO config_history (id, environment_id, key, value, type, description, action, revision, actor, created_at) VALUES (?, ?, 'flag', 'YES', 'text', '', 'create', ?, 'admin', '2026-01-01')",
            ).bind(`${prefix}-history-${index}`, environmentId, index + 1),
        ),
    );
    await env.DB.batch(
        Array.from({ length: count }, (_, index) =>
            env.DB.prepare('INSERT INTO api_keys (id, name, token, prefix) VALUES (?, ?, ?, ?)').bind(
                `${prefix}-key-${index}`,
                `Application ${index}`,
                `${prefix}-hash-${index}`,
                '01234567',
            ),
        ),
    );

    const base = `/projects/${projectSlug}/environments/env-0`;

    for (const path of ['/projects', `/projects/${projectSlug}/environments`, `${base}/configurations`, `${base}/history`, '/api-keys']) {
        const response = await exports.default.fetch(`${origin}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status).toBe(200);

        const result = await response.json<{
            items: unknown[];
            total: number;
            limit?: number;
            offset?: number;
        }>();

        expect(result.items.length).toBeGreaterThanOrEqual(count);
        expect(result.total).toBe(result.items.length);
        expect(result).not.toHaveProperty('limit');
        expect(result).not.toHaveProperty('offset');
        if (path === `/projects/${projectSlug}/environments`) {
            for (const environment of result.items) {
                expect(environment).not.toHaveProperty('config_count');
            }
        }
    }

    const created = await exports.default.fetch(`${origin}/api-keys`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Scoped collection reader',
            scopes: [{ project_id: projectId, environment_id: environmentId, permission: 'read' }],
        }),
    });

    const key = await created.json<{ token: string }>();

    expect(created.status).toBe(201);

    for (const path of ['/projects', `/projects/${projectSlug}/environments`]) {
        const result = await (
            await exports.default.fetch(`${origin}${path}`, {
                headers: { Authorization: `Bearer ${key.token}` },
            })
        ).json<{ items: unknown[] }>();

        expect(result.items).toHaveLength(1);
        if (path === `/projects/${projectSlug}/environments`) {
            expect(result.items[0]).not.toHaveProperty('config_count');
        }
    }

    const denied = await exports.default.fetch(`${origin}/projects/${projectSlug}/environments/env-1/configurations`, {
        headers: { Authorization: `Bearer ${key.token}` },
    });

    expect(denied.status).toBe(403);
});
