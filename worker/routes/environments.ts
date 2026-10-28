import { Hono } from 'hono';
import type { ApiBindings } from '../http';
import { body, fail, isAdmin, json, requireAdmin, slug, text } from '../common';
import { environmentAccess } from '../middleware';
import { routes as configRoutes } from './configs';
import { routes as historyRoutes } from './history';

/** Route the environments API resources using named path parameters. */
export const routes = new Hono<ApiBindings>();

routes.get('/', async (c) => {
    const env = c.env;
    const principal = c.get('principal');
    const project = c.get('project');
    const where = isAdmin(principal)
        ? 'e.project_id = ?'
        : 'e.project_id = ? AND EXISTS (SELECT 1 FROM api_key_scopes s WHERE s.api_key_id = ? AND (s.project_id IS NULL OR s.project_id = e.project_id) AND (s.environment_id IS NULL OR s.environment_id = e.id))';
    const parameters = isAdmin(principal) ? [project.id] : [project.id, principal.id];
    const result = await env.DB.prepare(
        `SELECT e.id, e.project_id, e.slug, e.description, e.revision FROM environments e WHERE ${where} ORDER BY e.created_at ASC, e.rowid ASC`,
    )
        .bind(...parameters)
        .all();

    return json({ items: result.results, total: result.results.length });
});

routes.post('/', async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const principal = c.get('principal');
    const project = c.get('project');

    requireAdmin(principal);

    const data = await body(request);
    const environment = {
        id: crypto.randomUUID(),
        project_id: project.id,
        slug: slug(data.slug),
        description: text(data.description ?? '', 'Description', 500, true),
        revision: 0,
    };

    const result = await env.DB.prepare(
        'INSERT INTO environments (id, project_id, slug, description) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?) ON CONFLICT(project_id, slug) DO NOTHING',
    )
        .bind(environment.id, project.id, environment.slug, environment.description, project.id)
        .run();

    if (!result.meta.changes) {
        if (!(await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(project.id).first())) {
            fail(404, 'project_not_found', 'The project does not exist.');
        }

        fail(409, 'environment_already_exists', 'The environment slug already exists.');
    }

    return json(environment, 201);
});

routes.all('/', () => fail(405, 'method_not_allowed', 'This request method is not supported.'));

routes.use('/:environment/*', environmentAccess);

routes.get('/:environment', async (c) => {
    const environment = c.get('environment');

    return json(environment);
});

routes.patch('/:environment', async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const principal = c.get('principal');
    const environment = c.get('environment');

    requireAdmin(principal);

    const data = await body(request);

    if (data.slug !== undefined && data.slug !== environment.slug) {
        fail(400, 'immutable_environment_identifier', 'The environment identifier cannot be changed.');
    }

    const description = text(data.description ?? '', 'Description', 500, true);

    await env.DB.prepare('UPDATE environments SET description = ? WHERE id = ?').bind(description, environment.id).run();

    return json({ ...environment, description });
});

routes.delete('/:environment', async (c) => {
    const principal = c.get('principal');
    const environment = c.get('environment');
    const coordinator = c.env.WATCH.getByName('global');

    requireAdmin(principal);

    return coordinator.mutate({
        environmentId: environment.id,
        operation: 'remove-environment',
        expectedRevision: null,
        actor: principal.name,
    });
});

routes.all('/:environment', () => fail(405, 'method_not_allowed', 'This request method is not supported.'));

routes.route('/:environment/configurations', configRoutes);

routes.route('/:environment/history', historyRoutes);
