import { expect, test } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import type { Config } from '../../worker/common';

/** Create one request client and deterministic fixtures with tied creation timestamps. */
async function setup() {
    const origin = 'https://lessconfig.test/api/v1';

    const login = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    const { token } = await login.json<{ token: string }>();

    const request = (path: string, method = 'GET', data?: object, headers: Record<string, string> = {}) =>
        exports.default.fetch(`${origin}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
            body: data === undefined ? undefined : JSON.stringify(data),
        });

    const prefix = crypto.randomUUID();
    const ids = ['z', 'a', 'm'].map((letter) => `${letter}-${prefix}`);
    const timestamps = ['2020-01-02T00:00:00Z', '2020-01-02T00:00:00Z', '2020-01-01T00:00:00Z'];

    await env.DB.batch(
        ids.map((id, index) =>
            env.DB.prepare('INSERT INTO projects (id,slug,name,created_at) VALUES (?,?,?,?)').bind(id, id, id, timestamps[index]),
        ),
    );
    await env.DB.batch(
        ids.map((id, index) =>
            env.DB.prepare('INSERT INTO environments (id,project_id,slug,created_at) VALUES (?,?,?,?)').bind(
                id,
                ids[0],
                id,
                timestamps[index],
            ),
        ),
    );

    return { request, ids, timestamps, base: `/projects/${ids[0]}/environments/${ids[0]}` };
}

test('distinguishes duplicate creation from a stale update without changing existing content', async () => {
    const { request, base } = await setup();
    const path = `${base}/configurations/flag`;

    const first = await request(path, 'PUT', { type: 'text', value: 'original' }, { 'If-None-Match': '*' });

    expect(first.status).toBe(201);

    const original = await first.json<Config>();

    const duplicate = await request(path, 'PUT', { type: 'text', value: 'overwrite' }, { 'If-None-Match': '*' });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
        code: 'config_already_exists',
        message: 'The configuration already exists.',
    });

    const stale = await request(path, 'PUT', { type: 'text', value: 'overwrite' }, { 'If-Match': '"0"' });

    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'config_revision_conflict' });
    expect(await (await request(path)).json()).toMatchObject(original);
    expect(await (await request(`${path}/history`)).json()).toMatchObject({ total: 1 });
});

test('orders resources by creation time and keeps edited configuration in its original position', async () => {
    const { request, ids, timestamps, base } = await setup();

    for (const path of ['/projects', `/projects/${ids[0]}/environments`]) {
        const list = await (await request(path)).json<{ items: { id: string }[] }>();

        expect(list.items.filter((item) => ids.includes(item.id)).map((item) => item.id)).toEqual([ids[2], ids[0], ids[1]]);
    }

    const keys = ['z-first', 'a-second', 'middle'];

    for (const [index, key] of keys.entries()) {
        expect((await request(`${base}/configurations/${key}`, 'PUT', { type: 'text', value: key }, { 'If-None-Match': '*' })).status).toBe(
            201,
        );
        // Control timestamps to verify chronological order and deterministic ties independently of the clock.
        await env.DB.prepare('UPDATE config_entries SET created_at = ? WHERE environment_id = ? AND key = ?')
            .bind(timestamps[index], ids[0], key)
            .run();
    }

    const first = await (await request(`${base}/configurations/z-first`)).json<Config>();

    const updated = await request(
        `${base}/configurations/z-first`,
        'PUT',
        { type: 'text', value: 'edited' },
        { 'If-Match': `"${first.revision}"` },
    );

    expect(updated.status).toBe(200);

    const saved = await updated.json<Config>();

    expect(saved.created_at).toBe(first.created_at);
    expect(saved.updated_at).not.toBe(saved.created_at);

    const list = await (await request(`${base}/configurations`)).json<{ items: Config[] }>();

    expect(list.items.map((item) => item.key)).toEqual(['middle', 'z-first', 'a-second']);

    expect(
        (
            await request(`${base}/configurations/z-first`, 'DELETE', undefined, {
                'If-Match': `"${saved.revision}"`,
            })
        ).status,
    ).toBe(200);

    const recreated = await request(`${base}/configurations/z-first`, 'PUT', { type: 'text', value: 'new' }, { 'If-None-Match': '*' });

    expect(recreated.status).toBe(201);
    expect((await recreated.json<Config>()).created_at).not.toBe(first.created_at);

    const finalList = await (await request(`${base}/configurations`)).json<{ items: Config[] }>();

    expect(finalList.items.map((item) => item.key)).toEqual(['middle', 'a-second', 'z-first']);
});
