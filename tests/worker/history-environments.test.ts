import { expect, test } from 'vitest';
import { exports } from 'cloudflare:workers';
import type { Environment } from '../../worker/common';

/** Only fields asserted by these HTTP contract tests are modeled here. */
type History = { id: string; action: string; value: string; revision: number };

type HistoryDetail = History & { previous: History | null };

type ListResponse<T> = { items: T[]; total: number };

/** Create independent project fixtures through the authenticated public API. */
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

    const slug = `history-${crypto.randomUUID()}`;

    expect((await request('/projects', 'POST', { slug, name: 'History fixture' })).status).toBe(201);

    return { request, project: `/projects/${slug}` };
}

test('uses immutable environment identifiers with optional editable remarks', async () => {
    const { request, project } = await setup();

    for (const slug of ['bad space', 'bad/path', 'bad*', '.', '..']) {
        expect((await request(`${project}/environments`, 'POST', { slug })).status).toBe(400);
    }

    const created = await request(`${project}/environments`, 'POST', { slug: 'prod-1' });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ slug: 'prod-1', description: '' });

    const path = `${project}/environments/prod-1`;

    expect((await request(path, 'PATCH', { slug: 'renamed', description: 'Rejected' })).status).toBe(400);
    expect((await request(path, 'PATCH', { description: 'a'.repeat(501) })).status).toBe(400);

    const changed = await request(path, 'PATCH', {
        slug: 'prod-1',
        description: 'Production · 生产',
    });

    expect(changed.status).toBe(200);

    const result = await changed.json<Environment>();

    expect(result).toMatchObject({ slug: 'prod-1', description: 'Production · 生产' });
    expect(result).not.toHaveProperty('name');

    const listed = await (await request(`${project}/environments`)).json<ListResponse<Environment>>();

    expect(listed.items[0]).toMatchObject({ slug: 'prod-1', description: result.description });
    expect((await request(`${project}/environments`, 'POST', { slug: 'prod-1' })).status).toBe(409);
});

test('returns the preceding event for the same key and environment across deletion and restoration', async () => {
    const { request, project } = await setup();

    for (const slug of ['prod', 'dev']) {
        expect((await request(`${project}/environments`, 'POST', { slug })).status).toBe(201);
    }

    const base = `${project}/environments/prod`;

    const put = async (key: string, value: string, revision?: number) => {
        const response = await request(
            `${base}/configurations/${key}`,
            'PUT',
            { value, type: 'text' },
            revision === undefined ? { 'If-None-Match': '*' } : { 'If-Match': `"${revision}"` },
        );

        expect(response.status).toBe(revision === undefined ? 201 : 200);

        return response.json<{ revision: number }>();
    };

    const first = await put('flag', 'YES');

    await put('unrelated', 'Do not compare this value');

    const second = await put('flag', 'NO', first.revision);

    expect(
        (
            await request(`${base}/configurations/flag`, 'DELETE', undefined, {
                'If-Match': `"${second.revision}"`,
            })
        ).status,
    ).toBe(200);

    const deletedHistory = await request(`${base}/configurations/flag/history`);

    expect(deletedHistory.status).toBe(200);
    expect(await deletedHistory.json()).toMatchObject({ total: 3 });
    await put('flag', 'RECREATED');

    const history = await (await request(`${base}/configurations/flag/history`)).json<ListResponse<History>>();

    expect(history.items.map((item) => item.action)).toEqual(['create', 'delete', 'update', 'create']);

    const details = await Promise.all(
        history.items.map(async (item) => (await request(`${base}/configurations/flag/history/${item.id}`)).json<HistoryDetail>()),
    );

    expect(details[0].previous).toMatchObject({ action: 'delete', value: 'NO' });
    expect(details[1].previous).toMatchObject({ action: 'update', value: 'NO' });
    expect(details[2].previous).toMatchObject({
        action: 'create',
        value: 'YES',
        revision: first.revision,
    });
    expect(details[3].previous).toBeNull();
    expect(await (await request(`${base}/history`)).json()).toMatchObject({ total: 5 });
    expect(await (await request(`${base}/configurations/unknown/history`)).json()).toMatchObject({
        total: 0,
    });

    const wrongKey = `${base}/configurations/unrelated/history/${details[1].id}`;

    expect((await request(wrongKey)).status).toBe(404);

    const wrongRestore = await request(`${wrongKey}/restore`, 'POST', undefined, {
        'If-Match': `"${details[0].revision}"`,
    });

    expect(wrongRestore.status).toBe(404);
    expect(await wrongRestore.json()).toMatchObject({ code: 'history_not_found' });
    expect((await request(`${project}/environments/dev/history/${details[0].id}`)).status).toBe(404);
    expect(
        (
            await request(`${base}/configurations/flag/history/${details[1].id}/restore`, 'POST', undefined, {
                'If-Match': `"${details[0].revision}"`,
            })
        ).status,
    ).toBe(200);

    const restored = await (await request(`${base}/configurations/flag`)).json<{ value: string }>();

    expect(restored.value).toBe('NO');
});
