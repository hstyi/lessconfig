import { expect, test } from 'vitest';
import { exports } from 'cloudflare:workers';
import { IDENTIFIER_MESSAGE, isIdentifier } from '../../shared/identifiers';
import { configKey, slug } from '../../worker/common';
import { parseWatchScopes } from '../../worker/watch';

test('uses one case-sensitive identifier rule across projects, environments, keys, and watch', () => {
    for (const value of ['A', '0', '-Prod', '.env', '_Prod', 'Test.A_1-2', '-', '_', '...', 'A'.repeat(201)]) {
        expect(isIdentifier(value)).toBe(true);
        expect(slug(value)).toBe(value);
        expect(configKey(value)).toBe(value);
        expect(parseWatchScopes(new URLSearchParams({ scopes: `${value}/${value}/${value}` }))).toEqual([
            { project: value, environment: value, key: value },
        ]);
    }
    for (const value of ['', '.', '..', 'bad/path', 'bad space', '*', '配置', 'bad\n', 'bad%2Fpath', 'bad?query', 'bad\\path']) {
        expect(isIdentifier(value), JSON.stringify(value)).toBe(false);
        expect(() => slug(value)).toThrow(IDENTIFIER_MESSAGE);
        expect(() => configKey(value)).toThrow(IDENTIFIER_MESSAGE);
    }
});

test('creates and retrieves mixed-case dotted identifiers and observes matching changes', async () => {
    const origin = 'https://lessconfig.test/api/v1';
    const login = await exports.default.fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    expect(login.status).toBe(200);
    const { token } = await login.json<{ token: string }>();
    const request = (path: string, method = 'GET', data?: object, headers = {}) =>
        exports.default.fetch(`${origin}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
            body: data === undefined ? undefined : JSON.stringify(data),
        });
    const project = `.Project_1-${crypto.randomUUID()}`;
    const environment = '-Env.Test_1';
    const key = '.Config_1-YAML';
    const base = `/projects/${project}/environments/${environment}`;

    expect((await request('/projects', 'POST', { slug: project, name: 'Shared identifier rules' })).status).toBe(201);
    expect((await request(`/projects/${project}/environments`, 'POST', { slug: environment })).status).toBe(201);
    const query = new URLSearchParams({ scopes: `${project}/${environment}/${key}` });
    const { revision } = await (await request(`/watch?${query}`)).json<{ revision: number }>();
    const saved = await request(`${base}/configurations/${key}`, 'PUT', { value: 'true', type: 'boolean' }, { 'If-None-Match': '*' });
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({ key, value: 'true' });
    expect(await (await request(`${base}/configurations/${key}`)).json()).toMatchObject({ key, value: 'true' });
    const observed = await request(`/watch?${query}&revision=${revision}&timeout=1`);
    expect(await observed.json()).toMatchObject({ changes: [{ project, environment, key, type: 'created' }] });

    expect((await request(`/projects/${project.toLowerCase()}`)).status).toBe(404);
    expect((await request('/projects', 'POST', { slug: project.toLowerCase(), name: 'Distinct case' })).status).toBe(201);
    expect((await request(`${base}/configurations/${key.toLowerCase()}`)).status).toBe(404);
});
