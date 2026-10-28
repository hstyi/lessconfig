import { expect, test } from 'vitest';
import { exports } from 'cloudflare:workers';

/** Exercise deletion through authenticated HTTP routes, including concurrent writers. */
async function client() {
    const origin = 'https://lessconfig.test/api/v1';

    const login = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });

    const { token } = await login.json<{ token: string }>();

    return (path: string, method = 'GET', data?: object, headers: Record<string, string> = {}) =>
        exports.default.fetch(`${origin}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
            body: data === undefined ? undefined : JSON.stringify(data),
        });
}

test('rejects nonempty parents without deleting their configuration or history', async () => {
    const request = await client();
    const project = `/projects/delete-${crypto.randomUUID()}`;

    expect(
        (
            await request('/projects', 'POST', {
                slug: project.split('/').at(-1),
                name: 'Deletion guard',
            })
        ).status,
    ).toBe(201);
    expect((await request(`${project}/environments`, 'POST', { slug: 'prod', description: 'Production' })).status).toBe(201);

    const environment = `${project}/environments/prod`;

    const config = await request(`${environment}/configurations/enabled`, 'PUT', { value: 'YES', type: 'text' }, { 'If-None-Match': '*' });

    const { revision } = await config.json<{ revision: number }>();
    const blockedProject = await request(project, 'DELETE');

    expect(blockedProject.status).toBe(409);
    expect(await blockedProject.json()).toEqual({
        code: 'project_not_empty',
        message: 'Delete all environments before deleting this project.',
    });

    const blockedEnvironment = await request(environment, 'DELETE');

    expect(blockedEnvironment.status).toBe(409);
    expect(await blockedEnvironment.json()).toEqual({
        code: 'environment_not_empty',
        message: 'Delete all configuration before deleting this environment.',
    });
    expect(await (await request(`${environment}/configurations/enabled`)).json()).toMatchObject({
        value: 'YES',
        revision,
    });
    expect(await (await request(`${environment}/history`)).json()).toMatchObject({ total: 1 });
    const deletedConfig = await request(`${environment}/configurations/enabled`, 'DELETE', undefined, {
        'If-Match': `"${revision}"`,
    });

    expect(deletedConfig.status).toBe(200);
    expect(await deletedConfig.json()).toEqual({ revision: expect.any(Number) });
    // History does not count as live configuration and is removed with the empty environment.
    const deletedEnvironment = await request(environment, 'DELETE');

    expect(deletedEnvironment.status).toBe(200);
    expect(await deletedEnvironment.json()).toEqual({ revision: expect.any(Number) });

    const deletedProject = await request(project, 'DELETE');

    expect(deletedProject.status).toBe(200);
    expect(await deletedProject.json()).toEqual({ revision: expect.any(Number) });
    expect((await request(project)).status).toBe(404);
});

test('concurrent child creation and parent deletion cannot both succeed', async () => {
    const request = await client();

    for (let attempt = 0; attempt < 3; attempt++) {
        const slug = `race-${crypto.randomUUID()}`;
        const project = `/projects/${slug}`;

        expect((await request('/projects', 'POST', { slug, name: 'Concurrent deletion' })).status).toBe(201);

        const [created, removed] = await Promise.all([
            request(`${project}/environments`, 'POST', { slug: 'prod', description: 'Production' }),
            request(project, 'DELETE'),
        ]);

        expect([created.status, removed.status]).toSatisfy(
            (statuses: number[]) => (statuses[0] === 201 && statuses[1] === 409) || (statuses[0] === 404 && statuses[1] === 200),
        );

        if (removed.status === 200) {
            expect((await request('/projects', 'POST', { slug, name: 'Configuration race' })).status).toBe(201);
            expect(
                (
                    await request(`${project}/environments`, 'POST', {
                        slug: 'prod',
                        description: 'Production',
                    })
                ).status,
            ).toBe(201);
        }

        const environment = `${project}/environments/prod`;

        const [written, deleted] = await Promise.all([
            request(`${environment}/configurations/enabled`, 'PUT', { value: 'YES', type: 'text' }, { 'If-None-Match': '*' }),
            request(environment, 'DELETE'),
        ]);

        expect([written.status, deleted.status]).toSatisfy(
            (statuses: number[]) => (statuses[0] === 201 && statuses[1] === 409) || (statuses[0] === 404 && statuses[1] === 200),
        );

        if (written.status === 201) {
            expect(await (await request(`${environment}/configurations/enabled`)).json()).toMatchObject({
                value: 'YES',
            });
        }
    }
});
