import { expect, test } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { digest, randomToken } from '../../worker/credentials';
import { SESSION_LIFETIME } from '../../worker/session';

const origin = 'https://lessconfig.test/api/v1';

/**
 * Send a request through the complete authentication boundary.
 * @param path - The versioned API path.
 * @param token - An optional Bearer credential.
 * @param method - The HTTP method.
 * @param data - The optional JSON request body.
 * @returns The Worker response.
 */
function request(path: string, token?: string, method = 'GET', data?: object) {
    return exports.default.fetch(`${origin}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data),
    });
}

/** Create an isolated account without changing the developer's credentials. */
async function account() {
    const username = `session-${crypto.randomUUID()}`;
    const row = await env.DB.prepare(
        "INSERT INTO users (username, role, password_hash, password_salt, password_iterations) SELECT ?, 'admin', password_hash, password_salt, password_iterations FROM users WHERE id = 1 RETURNING id, password_salt",
    )
        .bind(username)
        .first<{ id: number; password_salt: string }>();

    const login = async (password = 'admin') => {
        const response = await request('/auth/login', undefined, 'POST', { username, password });
        expect(response.status).toBe(200);
        expect(response.headers.get('Set-Cookie')).toMatch(/lessconfig_session=lcs_[a-f0-9]{64}; Path=\/api; HttpOnly; SameSite=Strict/);
        return response.json<{ token: string; expiresAt: string }>();
    };

    return { ...row!, username, login };
}

test('stores independent opaque sessions in KV under credential hashes with seven-day expiration', async () => {
    const user = await account();
    const before = Math.floor(Date.now() / 1000);
    const first = await user.login();
    const second = await user.login();
    expect(first.token).toMatch(/^lcs_[a-f0-9]{64}$/);
    expect(second.token).not.toBe(first.token);
    const key = `session:${await digest(first.token)}`;
    expect(await env.SESSIONS.get(key, 'json')).toEqual({
        userId: user.id,
        passwordSalt: user.password_salt,
        expiresAt: Date.parse(first.expiresAt) / 1000,
    });
    const listed = await env.SESSIONS.list({ prefix: key });
    const expiration = listed.keys[0].expiration!;
    expect(expiration).toBeGreaterThanOrEqual(before + SESSION_LIFETIME);
    expect(expiration).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + SESSION_LIFETIME);
    expect(await env.SESSIONS.get(first.token)).toBeNull();
    expect((await request('/auth/me', first.token)).status).toBe(200);
    expect((await request('/auth/me', randomToken('lcs_'))).status).toBe(401);
    expect((await request('/auth/me', 'old.account.signature')).status).toBe(401);
    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").first()).toBeNull();
});

test('rejects expired or invalid cached records independently of KV cleanup', async () => {
    const user = await account();
    const now = Math.floor(Date.now() / 1000);
    for (const changes of [{ expiresAt: now - 1 }, { expiresAt: now }, { userId: 0 }, { passwordSalt: 'old-password-salt' }]) {
        const token = randomToken('lcs_');
        await env.SESSIONS.put(
            `session:${await digest(token)}`,
            JSON.stringify({ userId: user.id, passwordSalt: user.password_salt, expiresAt: now + 60, ...changes }),
        );
        const response = await request('/auth/me', token);
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ code: 'session_expired' });
    }
});

test('logout deletes only the current session and rechecks suspended watches', async () => {
    const user = await account();
    const first = await user.login();
    const second = await user.login();
    const created = await request('/api-keys', first.token, 'POST', {
        name: 'Independent API credential',
        scopes: [{ project_id: '*', environment_id: '*', permission: 'read' }],
    });
    expect(created.status).toBe(201);
    const apiToken = (await created.json<{ token: string }>()).token;
    const initialized = await request('/watch?scopes=*', first.token);
    const { revision } = await initialized.json<{ revision: number }>();
    const pending = request(`/watch?scopes=*&revision=${revision}&timeout=1`, first.token);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logout = await request('/auth/logout', first.token, 'POST');
    expect(logout.status).toBe(200);
    expect(await logout.text()).toBe('');
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await env.SESSIONS.get(`session:${await digest(first.token)}`)).toBeNull();
    expect((await pending).status).toBe(401);
    expect((await request('/auth/me', first.token)).status).toBe(401);
    expect((await request('/auth/me', second.token)).status).toBe(200);
    expect((await request('/projects', apiToken)).status).toBe(200);
    const fresh = await user.login();
    expect((await request('/auth/logout', first.token, 'POST')).status).toBe(401);
    expect((await request('/auth/me', fresh.token)).status).toBe(200);
});

test('password changes reject every old session even while its KV record remains cached', async () => {
    const user = await account();
    const first = await user.login();
    const second = await user.login();
    const key = `session:${await digest(first.token)}`;
    const cached = await env.SESSIONS.get(key);
    const changed = await request('/auth/password', first.token, 'PUT', { currentPassword: 'admin', newPassword: 'new-session-password' });
    expect(changed.status).toBe(200);
    expect(await changed.text()).toBe('');
    expect(await env.SESSIONS.get(key)).toBe(cached);
    expect((await request('/auth/me', first.token)).status).toBe(401);
    expect((await request('/auth/me', second.token)).status).toBe(401);
    expect((await request('/auth/login', undefined, 'POST', { username: user.username, password: 'admin' })).status).toBe(401);
    const fresh = await user.login('new-session-password');
    expect((await request('/auth/me', fresh.token)).status).toBe(200);
});

test('replaces stale or malformed session cookies during password login', async () => {
    const user = await account();
    for (const token of ['lcs_old-session', 'old.account.signature', 'malformed-cookie', randomToken('lcs_')]) {
        const response = await exports.default.fetch(`${origin}/auth/login`, {
            method: 'POST',
            headers: { Origin: 'https://lessconfig.test', Cookie: `lessconfig_session=${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username, password: 'admin' }),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('Set-Cookie')).toMatch(/lessconfig_session=lcs_[a-f0-9]{64};/);
        const session = await response.json<{ token: string }>();
        expect((await request('/auth/me', session.token)).status).toBe(200);
    }
});
