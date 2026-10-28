import { beforeAll, expect, test } from 'vitest';
import { env, exports } from 'cloudflare:workers';

const origin = 'https://lessconfig.test';
const projectId = crypto.randomUUID();
const environmentId = crypto.randomUUID();
const base = '/api/v1/projects/router-test/environments/prod';
let token: string;

/** Prepare isolated resources so route assertions exercise real middleware and D1 bindings. */
beforeAll(async () => {
    await env.DB.batch([
        env.DB.prepare('INSERT INTO projects (id, slug, name) VALUES (?, ?, ?)').bind(projectId, 'router-test', 'Router test'),
        env.DB.prepare('INSERT INTO environments (id, project_id, slug, description) VALUES (?, ?, ?, ?)').bind(
            environmentId,
            projectId,
            'prod',
            'Production',
        ),
    ]);

    const response = await exports.default.fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    expect(response.status).toBe(200);
    token = (await response.json<{ token: string }>()).token;
});

/** Dispatch authenticated requests through the exported Hono Worker. */
function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);

    headers.set('Authorization', `Bearer ${token}`);

    return exports.default.fetch(`${origin}${path}`, { ...init, headers });
}

/** Password login stays public even when a browser retains an expired account session. */
test('permits password login with an expired session cookie', async () => {
    const expired = `lcs_${'0'.repeat(64)}`;
    const response = await exports.default.fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            Cookie: `lessconfig_session=${expired}`,
        },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ username: 'admin', kind: 'user' });
    expect(response.headers.get('Set-Cookie')).toMatch(/lessconfig_session=lcs_[a-f0-9]{64};/);
});

test('resolves encoded named parameters without confusing nested resources', async () => {
    const created = await request(`${base}/configurations/application%2Eyml`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
        body: JSON.stringify({ value: 'enabled: YES\n', type: 'yaml' }),
    });

    expect(created.status).toBe(201);
    await created.arrayBuffer();

    const raw = await request(`${base}/configurations/application.yml/raw`);

    expect(raw.headers.get('Content-Type')).toContain('application/yaml');
    expect(new TextDecoder().decode(await raw.arrayBuffer())).toBe('enabled: YES\n');

    const oldCollection = await request(`${base}/configs`);
    const oldItem = await request(`${base}/configs/application.yml`);

    expect(oldCollection.status).toBe(404);
    expect(oldItem.status).toBe(404);

    const invalidChild = await request(`${base}/configurations/application.yml/unknown`);

    expect(invalidChild.status).toBe(404);
    expect(await invalidChild.json()).toMatchObject({ code: 'endpoint_not_found' });
});

test('contains URL decoding and unsupported-method failures in the API error boundary', async () => {
    const malformed = await request(`${base}/configurations/%ZZ`);

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
        code: 'invalid_url_encoding',
        message: 'Invalid URL encoding.',
    });

    const unsupported = await request('/api/v1/projects', { method: 'PUT' });

    expect(unsupported.status).toBe(405);
    expect(await unsupported.json()).toMatchObject({ code: 'method_not_allowed' });

    const unknown = await request('/api/v1/unknown');

    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: 'endpoint_not_found' });
});

test('supports metadata HEAD requests without allowing HEAD to hold a watch open', async () => {
    const metadata = await request(base, { method: 'HEAD' });

    expect(metadata.status).toBe(200);
    expect(await metadata.text()).toBe('');

    const watch = await request('/api/v1/watch?scopes=router-test/prod&revision=0&timeout=60', {
        method: 'HEAD',
    });

    expect(watch.status).toBe(405);
    expect(await watch.text()).toBe('');
}, 3000);
