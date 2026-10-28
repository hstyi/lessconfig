import { expect, test } from 'vitest';
import { exports } from 'cloudflare:workers';
import { icons } from '@phosphor-icons/core';

/** Project icons must round-trip through D1 and reject values outside the shared catalog. */
test('defaults, persists, edits, and validates project icons', async () => {
    const origin = 'https://lessconfig.test/api/v1';

    const login = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    const { token } = await login.json<{ token: string }>();

    const request = (path: string, method = 'GET', data?: object) =>
        exports.default.fetch(`${origin}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: data === undefined ? undefined : JSON.stringify(data),
        });

    const slug = `icons-${crypto.randomUUID()}`;
    const created = await request('/projects', 'POST', { slug, name: 'Icons' });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ icon: 'folder-simple' });

    const path = `/projects/${slug}`;

    // Sample throughout the upstream catalog, including icons outside the former curated set.
    for (const { name: icon } of icons.filter((_, index) => index % 200 === 0 || index === icons.length - 1)) {
        const changed = await request(path, 'PATCH', { name: 'Icons', icon });

        expect(changed.status).toBe(200);
        expect(await changed.json()).toMatchObject({ icon });
        expect(await (await request(path)).json()).toMatchObject({ icon });
    }

    await request(path, 'PATCH', { name: 'Renamed', icon: 'cloud' });
    await request(path, 'PATCH', { name: 'Metadata only', description: 'Keep icon' });
    expect(await (await request(path)).json()).toMatchObject({ icon: 'cloud' });

    const listed = await (await request('/projects')).json<{ items: { slug: string; icon: string }[] }>();

    expect(listed.items.find((item) => item.slug === slug)?.icon).toBe('cloud');

    for (const icon of ['missing', 'constructor', '__proto__', '<svg />', '', null, 12, {}]) {
        const invalid = await request(path, 'PATCH', { name: 'Icons', icon });

        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toEqual({
            code: 'invalid_project_icon',
            message: 'The project icon is not supported.',
        });
        expect((await request('/projects', 'POST', { slug: `${slug}-invalid`, name: 'Icons', icon })).status).toBe(400);
    }

    const custom = await request('/projects', 'POST', {
        slug: `${slug}-custom`,
        name: 'Custom',
        icon: 'rocket-launch',
    });

    expect(custom.status).toBe(201);
    expect(await custom.json()).toMatchObject({ icon: 'rocket-launch' });
});
