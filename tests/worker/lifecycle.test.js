import { expect, test } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

const origin = 'https://lessconfig.test';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Keep assertion labels close to the end-to-end security and consistency checks. */
function check(value, expected, label) {
    expect(value, label).toEqual(expected);
}

async function request(path, { token, method = 'GET', data, headers = {}, signal } = {}) {
    const response = await exports.default.fetch(`${origin}/api/v1${path}`, {
        method,
        signal,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: data !== undefined ? JSON.stringify(data) : undefined,
    });

    const value = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : new TextDecoder().decode(await response.arrayBuffer());

    return { status: response.status, value, headers: response.headers };
}

test('single-admin configuration lifecycle, scoped access, history, and long polling', async () => {
    check((await request('/projects')).status, 401, 'authentication required');

    const login = await request('/auth/login', {
        method: 'POST',
        data: { username: 'admin', password: 'admin' },
    });

    check(login.status, 200, 'bootstrap login');

    const admin = login.value.token;

    check(login.value.defaultPassword, true, 'bootstrap indicator');
    check(login.headers.get('set-cookie').includes('HttpOnly'), true, 'HttpOnly cookie');
    check(
        (
            await request('/auth/login', {
                method: 'POST',
                data: { username: 'admin', password: 'wrong' },
            })
        ).status,
        401,
        'wrong password',
    );
    check((await request('/auth/register', { token: admin, method: 'POST', data: {} })).status, 404, 'no registration');
    check((await request('/users', { token: admin })).status, 404, 'no multiuser API');

    const a = (
        await request('/projects', {
            token: admin,
            method: 'POST',
            data: { slug: 'payment', name: '支付服务' },
        })
    ).value;

    const b = (
        await request('/projects', {
            token: admin,
            method: 'POST',
            data: { slug: 'other', name: '其他服务' },
        })
    ).value;

    check(
        (
            await request('/projects', {
                token: admin,
                method: 'POST',
                data: { slug: 'payment', name: '重复' },
            })
        ).status,
        409,
        'duplicate project',
    );

    const prod = (
        await request('/projects/payment/environments', {
            token: admin,
            method: 'POST',
            data: { slug: 'prod', description: '生产环境' },
        })
    ).value;

    const dev = (
        await request('/projects/payment/environments', {
            token: admin,
            method: 'POST',
            data: { slug: 'dev', description: '开发环境' },
        })
    ).value;

    const other = (
        await request('/projects/other/environments', {
            token: admin,
            method: 'POST',
            data: { slug: 'prod', description: '生产' },
        })
    ).value;

    const base = '/projects/payment/environments/prod';
    const createHeaders = { 'If-None-Match': '*' };

    const write = (key, value, revision, type = 'text', token = admin) =>
        request(`${base}/configurations/${key}`, {
            token,
            method: 'PUT',
            data: { value, type, description: '测试配置' },
            headers: revision === undefined ? createHeaders : { 'If-Match': `"${revision}"` },
        });

    check(
        (
            await request(`${base}/configurations/missing-precondition`, {
                token: admin,
                method: 'PUT',
                data: { value: 'x', type: 'text' },
            })
        ).status,
        428,
        'write precondition required',
    );

    const initial = await write('feature.enabled', 'YES');

    check(initial.status, 201, 'create config');
    check(initial.value.value, 'YES', 'preserve raw scalar');
    check('environment_id' in initial.value, false, 'created configuration omits environment ID');
    check((await request(`${base}/configurations/feature.enabled/raw`, { token: admin })).value, 'YES', 'raw endpoint');

    const yaml = '# 保留注释\nserver:\n  port: 8080\n';

    check((await write('application.yml', yaml, undefined, 'yaml')).status, 201, 'create YAML');
    check((await request(`${base}/configurations/application.yml/raw`, { token: admin })).value, yaml, 'preserve YAML formatting');
    check((await write('bad.yaml', 'a: [', undefined, 'yaml')).status, 400, 'reject invalid YAML');
    check((await write('bad.json', '{', undefined, 'json')).status, 400, 'reject invalid JSON');
    check((await write('bad.boolean', 'YES', undefined, 'boolean')).status, 400, 'boolean type explicit');

    const listing = await request(`${base}/configurations`, { token: admin });

    check(listing.status, 200, 'configuration list');
    check(listing.value.total, 2, 'complete configuration list');
    check('value' in listing.value.items[0], true, 'configuration listing includes content');
    check(
        listing.value.items.every((item) => !('environment_id' in item)),
        true,
        'configuration list omits environment IDs',
    );
    await write('a_b', 'literal');
    await write('axb', 'other');
    check((await request(`${base}/configurations`, { token: admin })).value.total, 4, 'complete list includes both keys');
    check((await write('feature.enabled', 'NO', 999)).status, 409, 'stale write rejected');

    const concurrent = await Promise.all([
        write('feature.enabled', 'NO', initial.value.revision),
        write('feature.enabled', 'MAYBE', initial.value.revision),
    ]);

    check(concurrent.map((r) => r.status).sort(), [200, 409], 'concurrent compare-and-swap');

    let current = (await request(`${base}/configurations/feature.enabled`, { token: admin })).value;

    check('environment_id' in current, false, 'configuration detail omits environment ID');

    const noOp = await write('feature.enabled', current.value, current.revision);

    check(noOp.value.revision, current.revision, 'no-op preserves revision');
    check('environment_id' in noOp.value, false, 'unchanged save omits environment ID');

    const initialWatch = (await request('/watch?scopes=payment/prod', { token: admin })).value;
    const configuration = (await request(`${base}/configurations`, { token: admin })).value;

    check(
        configuration.items.some((c) => c.key === 'application.yml' && c.value === yaml),
        true,
        'environment list contains original file',
    );

    const waiting = request(`/watch?scopes=payment/prod&revision=${initialWatch.revision}&timeout=5`, {
        token: admin,
    });

    await delay(200);

    const updated = await write('feature.enabled', 'CHANGED', current.revision);

    check('environment_id' in updated.value, false, 'updated configuration omits environment ID');

    const notified = await waiting;

    check(notified.status, 200, 'watch wake status');
    check(notified.value.changes.length > 0, true, 'watch wake on change');
    check(notified.value.revision, updated.value.revision, 'watch revision');

    const timeout = await request(`/watch?scopes=payment/prod&revision=${notified.value.revision}&timeout=1`, { token: admin });

    check(timeout.value.changes, [], 'normal watch timeout');
    check(
        (await request('/watch?scopes=payment/prod&revision=999999&timeout=1', { token: admin })).status,
        409,
        'future revisions require resynchronization',
    );
    check((await request('/watch?scopes=payment/prod&revision=0&timeout=301', { token: admin })).status, 400, 'bounded watch');

    const keyResult = await request('/api-keys', {
        token: admin,
        method: 'POST',
        data: {
            name: 'application',
            scopes: [
                { project_id: a.id, environment_id: prod.id, permission: 'read' },
                { project_id: a.id, environment_id: dev.id, permission: 'write' },
            ],
        },
    });

    check(keyResult.status, 201, 'create scoped key');

    const key = keyResult.value.token;

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    check(
        (await request('/projects', { token: key })).value.items.map((p) => p.slug),
        ['payment'],
        'project list filtered',
    );
    check((await request('/projects/payment/environments', { token: key })).value.items.length, 2, 'environment grants');
    check((await request('/projects/other', { token: key })).status, 403, 'project isolation');
    check(
        (await request('/projects/payment/environments/prod/configurations', { token: key })).status,
        200,
        'read environment configuration',
    );
    check((await write('not.allowed', 'x', undefined, 'text', key)).status, 403, 'read key cannot write');
    check(
        (
            await request('/projects/payment/environments/dev/configurations/allowed', {
                token: key,
                method: 'PUT',
                data: { value: 'true', type: 'boolean' },
                headers: createHeaders,
            })
        ).status,
        201,
        'write key allowed in its environment',
    );
    check(
        (await request('/projects/payment/environments/dev', { token: key, method: 'DELETE' })).status,
        403,
        'write key cannot delete environment',
    );
    check((await request('/api-keys', { token: key })).status, 403, 'key cannot administer keys');
    check((await request('/auth/password', { token: key, method: 'PUT', data: {} })).status, 403, 'key cannot change admin');
    check(
        (
            await request('/api-keys', {
                token: admin,
                method: 'POST',
                data: {
                    name: 'bad grant',
                    scopes: [{ project_id: a.id, environment_id: other.id, permission: 'read' }],
                },
            })
        ).status,
        400,
        'cross-project grant rejected',
    );

    const whole = (
        await request('/api-keys', {
            token: admin,
            method: 'POST',
            data: {
                name: 'whole project',
                scopes: [{ project_id: a.id, environment_id: '*', permission: 'read' }],
            },
        })
    ).value;

    await request('/projects/payment/environments', {
        token: admin,
        method: 'POST',
        data: { slug: 'future', description: '未来环境' },
    });
    check(
        (await request('/projects/payment/environments/future/configurations', { token: whole.token })).status,
        200,
        'whole project includes future environments',
    );
    check(
        (await request('/projects/payment/environments/future/configurations', { token: key })).status,
        403,
        'explicit environments exclude future',
    );

    const deletedTokenWatch = request(`/watch?scopes=payment/prod&revision=${notified.value.revision}&timeout=1`, { token: key });

    await delay(150);
    await request(`/api-keys/${keyResult.value.id}`, { token: admin, method: 'DELETE' });
    check((await deletedTokenWatch).status, 401, 'deleted token pending watch reauthorized');
    check((await request(`${base}/configurations`, { token: key })).status, 401, 'token deletion');

    const keyList = (await request('/api-keys', { token: admin })).value;

    check('token' in keyList.items[0], false, 'key secret not listed');
    check(
        (
            await request('/api-keys', {
                token: admin,
                method: 'POST',
                data: {
                    name: 'expired',
                    expires_at: '2020-01-01',
                    scopes: [{ project_id: b.id, environment_id: '*', permission: 'read' }],
                },
            })
        ).status,
        400,
        'past expiry rejected',
    );

    const shortKey = (
        await request('/api-keys', {
            token: admin,
            method: 'POST',
            data: {
                name: 'short',
                expires_at: new Date().toISOString().slice(0, 10),
                scopes: [{ project_id: a.id, environment_id: prod.id, permission: 'read' }],
            },
        })
    ).value;

    const expiringWatch = request(`/watch?scopes=payment/prod&revision=${notified.value.revision}&timeout=2`, { token: shortKey.token });

    await delay(150);
    // Simulate the date passing while the request is suspended, without waiting for midnight.
    await env.DB.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').bind('2020-01-01', shortKey.id).run();
    check((await expiringWatch).status, 401, 'expiry while waiting');

    const history = (await request(`${base}/configurations/feature.enabled/history`, { token: admin })).value;

    const firstVersion = history.items.at(-1);

    check(
        (
            await request(`${base}/configurations/feature.enabled`, {
                token: admin,
                method: 'DELETE',
                headers: { 'If-Match': `"${updated.value.revision}"` },
            })
        ).status,
        200,
        'delete config',
    );
    check((await request(`${base}/configurations/feature.enabled`, { token: admin })).status, 404, 'deleted config missing');

    const restored = await request(`${base}/history/${firstVersion.id}/restore`, {
        token: admin,
        method: 'POST',
        headers: createHeaders,
    });

    check(restored.status, 201, 'restore deleted config');
    check(restored.value.value, 'YES', 'restored original contents');
    check('environment_id' in restored.value, false, 'restored configuration omits environment ID');
    check(restored.value.revision > updated.value.revision, true, 'rollback advances revision');

    const cookie = login.headers.get('set-cookie').split(';')[0];

    check(
        (
            await request('/projects', {
                method: 'POST',
                headers: { Cookie: cookie, Origin: 'https://evil.example' },
                data: { name: 'evil', slug: 'evil' },
            })
        ).status,
        403,
        'cross-origin rejected',
    );
    check(
        (
            await request('/projects', {
                method: 'POST',
                headers: { Cookie: cookie, Origin: origin },
                data: { name: 'cookie', slug: 'cookie' },
            })
        ).status,
        201,
        'same-origin cookie works',
    );
    check(
        (await request('/projects/payment/environments/dev', { token: admin, method: 'DELETE' })).status,
        409,
        'nonempty environment cannot be deleted',
    );

    const devEntries = (await request('/projects/payment/environments/dev/configurations', { token: admin })).value.items;

    for (const entry of devEntries) {
        check(
            (
                await request(`/projects/payment/environments/dev/configurations/${entry.key}`, {
                    token: admin,
                    method: 'DELETE',
                    headers: { 'If-Match': `"${entry.revision}"` },
                })
            ).status,
            200,
            'clear environment before deletion',
        );
    }

    const deleteRevision = (await request('/watch?scopes=payment/dev', { token: admin })).value.revision;

    const deletedWatch = request(`/watch?scopes=payment/dev&revision=${deleteRevision}&timeout=5`, {
        token: admin,
    });

    await delay(100);
    check((await request('/projects/payment/environments/dev', { token: admin, method: 'DELETE' })).status, 200, 'delete environment');
    check((await deletedWatch).value.changes[0].resource, 'environment', 'deleted environment wakes watcher');
    check(
        (await request('/projects/other', { token: admin, method: 'DELETE' })).status,
        409,
        'project containing an empty environment cannot be deleted',
    );
    check(
        (await request('/projects/other/environments/prod', { token: admin, method: 'DELETE' })).status,
        200,
        'remove the empty environment first',
    );
    check((await request('/projects/other', { token: admin, method: 'DELETE' })).status, 200, 'delete project');
    const passwordChanged = await request('/auth/password', {
        token: admin,
        method: 'PUT',
        data: { currentPassword: 'admin', newPassword: 'new-admin-password' },
    });

    check(passwordChanged.status, 200, 'change password');
    check(passwordChanged.value, '', 'password change returns an empty body');
    check(passwordChanged.headers.get('content-type'), null, 'password change does not advertise JSON');
    check(passwordChanged.headers.get('cache-control'), 'no-store', 'password change cannot be cached');
    check(passwordChanged.headers.get('set-cookie').includes('Max-Age=0'), true, 'password change clears the session cookie');
    check((await request('/auth/me', { token: admin })).status, 401, 'password change revokes sessions');
    check(
        (await request('/projects/payment/environments/prod/configurations', { token: whole.token })).status,
        200,
        'password change preserves API tokens',
    );

    const newLogin = await request('/auth/login', {
        method: 'POST',
        data: { username: 'admin', password: 'new-admin-password' },
    });

    check(newLogin.status, 200, 'new password works');
    check(newLogin.value.defaultPassword, false, 'default flag cleared');
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    check(
        (
            await request('/auth/login', {
                method: 'POST',
                data: { username: 'admin', password: 'admin' },
            })
        ).status,
        401,
        'migration does not reset password',
    );
    const loggedOut = await request('/auth/logout', { token: newLogin.value.token, method: 'POST' });

    check(loggedOut.status, 200, 'logout');
    check(loggedOut.value, '', 'logout returns an empty body');
    check(loggedOut.headers.get('content-type'), null, 'logout does not advertise JSON');
    check(loggedOut.headers.get('cache-control'), 'no-store', 'logout cannot be cached');
    check(loggedOut.headers.get('set-cookie').includes('Max-Age=0'), true, 'logout clears the session cookie');
    check((await request('/auth/me', { token: newLogin.value.token })).status, 401, 'logged out token invalid');
});
