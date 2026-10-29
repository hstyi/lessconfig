import { Hono } from 'hono';
import type { ApiBindings } from '../http';
import { body, condition, type Config, configInput, configKey, fail, json } from '../common';
import { routes as historyRoutes } from './history';

/** Route the configs API resources using named path parameters. */
export const routes = new Hono<ApiBindings>();

routes.route('/:key/history', historyRoutes);

routes.get('/', async (c) => {
    const env = c.env;
    const environment = c.get('environment');
    const results = await env.DB.batch([
        env.DB.prepare('SELECT id FROM environments WHERE id = ?').bind(environment.id),
        env.DB.prepare(
            'SELECT key, value, type, description, revision, created_at, updated_at, length(CAST(value AS BLOB)) AS bytes FROM config_entries WHERE environment_id = ? ORDER BY created_at ASC, rowid ASC',
        ).bind(environment.id),
    ]);

    if (!results[0].results.length) {
        fail(404, 'environment_not_found', 'The environment has been deleted.');
    }

    return json({
        items: results[1].results,
        total: results[1].results.length,
    });
});

routes.put('/:key', async (c) => {
    const request = c.req.raw;
    const environment = c.get('environment');
    const coordinator = c.env.WATCH.getByName('global');

    const actor = c.get('principal').kind === 'key' ? `API Token: ${c.get('principal').name}` : c.get('principal').name;

    const key = configKey(c.req.param('key'));

    return coordinator.mutate({
        environmentId: environment.id,
        key,
        operation: 'put',
        input: configInput(await body(request)),
        expectedRevision: condition(request),
        actor,
    });
});

routes.delete('/:key', async (c) => {
    const request = c.req.raw;
    const environment = c.get('environment');
    const coordinator = c.env.WATCH.getByName('global');

    const actor = c.get('principal').kind === 'key' ? `API Token: ${c.get('principal').name}` : c.get('principal').name;

    const key = configKey(c.req.param('key'));

    return coordinator.mutate({
        environmentId: environment.id,
        key,
        operation: 'delete',
        expectedRevision: condition(request),
        actor,
    });
});

routes.get('/:key', async (c) => {
    const env = c.env;
    const environment = c.get('environment');
    const key = configKey(c.req.param('key'));

    const config = await env.DB.prepare(
        'SELECT key, value, type, description, revision, created_at, updated_at FROM config_entries WHERE environment_id = ? AND key = ?',
    )
        .bind(environment.id, key)
        .first<Omit<Config, 'environment_id'>>();

    if (!config) {
        fail(404, 'config_not_found', 'The configuration does not exist.');
    }

    return json(config, 200, { ETag: `"${config.revision}"` });
});

routes.get('/:key/raw', async (c) => {
    const env = c.env;
    const environment = c.get('environment');
    const key = configKey(c.req.param('key'));

    const config = await env.DB.prepare('SELECT * FROM config_entries WHERE environment_id = ? AND key = ?')
        .bind(environment.id, key)
        .first<Config>();

    if (!config) {
        fail(404, 'config_not_found', 'The configuration does not exist.');
    }

    return new Response(config.value, {
        headers: {
            'Content-Type': `${config.type === 'json' ? 'application/json' : config.type === 'yaml' ? 'application/yaml' : 'text/plain'}; charset=utf-8`,
            'Content-Disposition': `${c.req.query('download') === '1' ? 'attachment' : 'inline'}; filename="${key}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ETag: `"${config.revision}"`,
        },
    });
});
