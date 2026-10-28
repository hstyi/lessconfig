import { Hono } from 'hono';
import type { ApiBindings } from '../http';
import { emptyResponse, fail, requireAdmin } from '../common';
import { listKeys, createKey } from '../keys';

/** Route the api-keys API resources using named path parameters. */
export const routes = new Hono<ApiBindings>();

routes.use('*', async (c, next) => {
    requireAdmin(c.get('principal'));
    await next();
});

routes.get('/', async (c) => {
    const env = c.env;

    return listKeys(env);
});

routes.post('/', async (c) => {
    const request = c.req.raw;
    const env = c.env;

    return createKey(request, env);
});

routes.delete('/:id', async (c) => {
    const env = c.env;

    const result = await env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(c.req.param('id')).run();

    if (!result.meta.changes) {
        fail(404, 'api_token_not_found', 'The API token does not exist.');
    }

    return emptyResponse();
});
