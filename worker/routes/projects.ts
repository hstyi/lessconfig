import { Hono } from 'hono';
import { isString } from 'lodash-es';
import type { ApiBindings } from '../http';
import { body, fail, isAdmin, json, requireAdmin, slug, text } from '../common';
import { projectAccess } from '../middleware';
import { routes as environmentRoutes } from './environments';
import { icons, type PhosphorIcon } from '@phosphor-icons/core';

const projectIcons = new Set<string>(icons.map((icon) => icon.name));

/** Reject unsupported icons and preserve the existing icon when PATCH omits it. */
function projectIcon(value: unknown, fallback: PhosphorIcon['name'] = 'folder-simple'): PhosphorIcon['name'] {
    if (value === undefined) {
        return fallback;
    }

    if (!isString(value) || !projectIcons.has(value)) {
        fail(400, 'invalid_project_icon', 'The project icon is not supported.');
    }

    return value as PhosphorIcon['name'];
}

/** Route the projects API resources using named path parameters. */
export const routes = new Hono<ApiBindings>();

routes.get('/', async (c) => {
    const env = c.env;
    const principal = c.get('principal');

    if (principal.kind === 'user' && !isAdmin(principal)) {
        return json({ items: [], total: 0 });
    }

    const where = isAdmin(principal)
        ? '1 = 1'
        : 'EXISTS (SELECT 1 FROM api_key_scopes s WHERE (s.project_id IS NULL OR s.project_id = p.id) AND s.api_key_id = ?)';

    const parameters = isAdmin(principal) ? [] : [principal.id];

    const result = await env.DB.prepare(`SELECT p.* FROM projects p WHERE ${where} ORDER BY p.created_at ASC, p.rowid ASC`)
        .bind(...parameters)
        .all();

    return json({ items: result.results, total: result.results.length });
});

routes.post('/', async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const principal = c.get('principal');

    requireAdmin(principal);

    const data = await body(request);

    const project = {
        id: crypto.randomUUID(),
        slug: slug(data.slug),
        name: text(data.name, 'Project name').trim(),
        icon: projectIcon(data.icon),
        description: text(data.description ?? '', 'Description', 500, true),
    };

    const result = await env.DB.prepare(
        'INSERT INTO projects (id, slug, name, icon, description) VALUES (?, ?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING',
    )
        .bind(project.id, project.slug, project.name, project.icon, project.description)
        .run();

    if (!result.meta.changes) {
        fail(409, 'project_already_exists', 'The project slug already exists.');
    }

    return json(project, 201);
});

routes.all('/', () => fail(405, 'method_not_allowed', 'This request method is not supported.'));

routes.use('/:project/*', projectAccess);

routes.get('/:project', async (c) => {
    const project = c.get('project');

    return json(project);
});

routes.patch('/:project', async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const principal = c.get('principal');
    const project = c.get('project');

    requireAdmin(principal);

    const data = await body(request);
    const name = text(data.name, 'Project name').trim();
    const icon = projectIcon(data.icon, project.icon);
    const description = text(data.description ?? '', 'Description', 500, true);

    await env.DB.prepare('UPDATE projects SET name = ?, icon = ?, description = ? WHERE id = ?')
        .bind(name, icon, description, project.id)
        .run();

    return json({ ...project, name, icon, description });
});

routes.delete('/:project', async (c) => {
    const principal = c.get('principal');
    const project = c.get('project');

    requireAdmin(principal);

    return c.env.WATCH.getByName('global').mutate({
        operation: 'remove-project',
        projectId: project.id,
    });
});

routes.all('/:project', () => fail(405, 'method_not_allowed', 'This request method is not supported.'));

routes.route('/:project/environments', environmentRoutes);
