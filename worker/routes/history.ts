import { Hono } from 'hono';
import type { ApiBindings } from '../http';
import { condition, configKey, fail, json } from '../common';

/** Stored history metadata used to locate the preceding version of the same key. */
type HistoryRecord = { key: string; revision: number } & Record<string, unknown>;

/** Share history handlers between environment-wide and configuration-specific resource paths. */
export const routes = new Hono<ApiBindings>();

routes.get('/', async (c) => {
    const env = c.env;
    const environment = c.get('environment');
    const key = c.req.param('key');
    const where = `environment_id = ?${key !== undefined ? ' AND key = ?' : ''}`;
    const params = key !== undefined ? [environment.id, configKey(key)] : [environment.id];

    const result = await env.DB.prepare(
        `SELECT id, key, type, description, action, revision, actor, created_at FROM config_history WHERE ${where} ORDER BY revision DESC`,
    )
        .bind(...params)
        .all();

    return json({ items: result.results, total: result.results.length });
});

routes.get('/:id', async (c) => {
    const env = c.env;
    const environment = c.get('environment');
    const key = c.req.param('key');

    const history = await env.DB.prepare('SELECT * FROM config_history WHERE environment_id = ? AND id = ? AND (? IS NULL OR key = ?)')
        .bind(environment.id, c.req.param('id'), key ?? null, key === undefined ? null : configKey(key))
        .first<HistoryRecord>();

    if (!history) {
        fail(404, 'history_not_found', 'The history entry does not exist.');
    }

    const previous = await env.DB.prepare(
        'SELECT * FROM config_history WHERE environment_id = ? AND key = ? AND revision < ? ORDER BY revision DESC LIMIT 1',
    )
        .bind(environment.id, history.key, history.revision)
        .first();

    return json({ ...history, previous });
});

routes.post('/:id/restore', async (c) => {
    const request = c.req.raw;
    const environment = c.get('environment');
    const key = c.req.param('key');
    const coordinator = c.env.WATCH.getByName('global');

    const actor = c.get('principal').kind === 'key' ? `API Token: ${c.get('principal').name}` : c.get('principal').name;

    return coordinator.mutate({
        environmentId: environment.id,
        key: key === undefined ? undefined : configKey(key),
        operation: 'restore',
        historyId: c.req.param('id'),
        expectedRevision: condition(request),
        actor,
    });
});
