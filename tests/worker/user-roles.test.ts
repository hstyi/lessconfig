import { expect, test } from 'vitest';
import { env, exports } from 'cloudflare:workers';

/** Account permissions follow the persisted role, independently of the username. */
test('uses the current account role to authorize sessions', async () => {
    await env.DB.prepare("UPDATE users SET username = 'root' WHERE id = 1").run();
    await env.DB.prepare(
        "INSERT INTO users (username, password_hash, password_salt, password_iterations) SELECT 'admin', password_hash, password_salt, password_iterations FROM users WHERE id = 1",
    ).run();

    const origin = 'https://lessconfig.test/api/v1';
    const login = async (username: string) => {
        const response = await exports.default.fetch(`${origin}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: 'admin' }),
        });
        expect(response.status).toBe(200);
        return response.json<{ token: string; role: string; kind: string }>();
    };
    const request = (token: string, path: string, method = 'GET') =>
        exports.default.fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });

    const root = await login('root');
    const ordinary = await login('admin');
    expect(root).toMatchObject({ role: 'admin', kind: 'user' });
    expect(ordinary).toMatchObject({ role: 'user', kind: 'user' });
    expect(await (await request(ordinary.token, '/auth/me')).json()).toMatchObject({ username: 'admin', role: 'user', kind: 'user' });
    expect((await request(root.token, '/api-keys')).status).toBe(200);
    expect((await request(ordinary.token, '/api-keys')).status).toBe(403);
    expect((await request(ordinary.token, '/watch?scopes=*')).status).toBe(403);
    expect(await (await request(ordinary.token, '/projects')).json()).toEqual({ items: [], total: 0 });

    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE username = 'admin'").run();
    expect((await request(ordinary.token, '/api-keys')).status).toBe(200);
    expect((await request(ordinary.token, '/watch?scopes=*')).status).toBe(200);

    await env.DB.prepare("UPDATE users SET role = 'user' WHERE id = 1").run();
    expect((await request(root.token, '/api-keys')).status).toBe(403);
    expect(await (await request(root.token, '/auth/me')).json()).toMatchObject({ username: 'root', role: 'user', kind: 'user' });
    expect((await request(root.token, '/auth/logout', 'POST')).status).toBe(200);
    expect((await request(root.token, '/auth/me')).status).toBe(401);
    await expect(env.DB.prepare("UPDATE users SET role = 'invalid' WHERE id = 1").run()).rejects.toThrow();
});
