import { createMiddleware } from 'hono/factory';
import { authenticate, checkOrigin, tokenFrom } from './auth';
import { fail, isAdmin, permitted, type Environment, type Project } from './common';
import type { ApiBindings } from './http';

/** Reject cross-origin writes and malformed URL escapes before dispatching a route. */
export const requestGuard = createMiddleware<ApiBindings>(async (c, next) => {
    checkOrigin(c.req.raw);

    try {
        decodeURI(new URL(c.req.url).pathname);
    } catch {
        fail(400, 'invalid_url_encoding', 'Invalid URL encoding.');
    }

    await next();
});

/** Resolve credentials and enforce the API token endpoint allowlist before routing. */
export const authentication = createMiddleware<ApiBindings>(async (c, next) => {
    const path = c.req.path;

    if (c.req.method === 'POST' && path === '/api/v1/auth/login') {
        const token = tokenFrom(c.req.raw);

        // Stale or malformed session cookies must never block password login. API tokens remain restricted.
        if (!/^[a-f0-9]{64}$/.test(token)) {
            await next();
            return;
        }
    }

    const principal = await authenticate(c.req.raw, c.env, c.executionCtx);
    const tokenEndpoint = path === '/api/v1/projects' || path.startsWith('/api/v1/projects/') || path === '/api/v1/watch';

    if (principal.kind === 'key' && !tokenEndpoint) {
        fail(403, 'api_token_endpoint_forbidden', 'API tokens may only access project resources and watch.');
    }

    c.set('principal', principal);
    await next();
});

/** Load the named project and reject API tokens without a project grant. */
export const projectAccess = createMiddleware<ApiBindings>(async (c, next) => {
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE slug = ?').bind(c.req.param('project')).first<Project>();

    if (!project) {
        fail(404, 'project_not_found', 'The project does not exist.');
    }

    const principal = c.get('principal');

    if (!isAdmin(principal) && !principal.scopes.some((s) => s.project_id === '*' || s.project_id === project.id)) {
        fail(403, 'project_access_denied', 'Access to this project is denied.');
    }

    c.set('project', project);
    await next();
});

/** Enforce environment-level read or edit access before any resource handler runs. */
export const environmentAccess = createMiddleware<ApiBindings>(async (c, next) => {
    const environment = await c.env.DB.prepare(
        'SELECT id, project_id, slug, description, revision FROM environments WHERE project_id = ? AND slug = ?',
    )
        .bind(c.get('project').id, c.req.param('environment'))
        .first<Environment>();

    if (!environment) {
        fail(404, 'environment_not_found', 'The environment does not exist.');
    }

    const editing = !['GET', 'HEAD'].includes(c.req.method);

    if (!permitted(c.get('principal'), environment, editing)) {
        fail(
            403,
            editing ? 'environment_edit_denied' : 'environment_read_denied',
            editing ? 'Edit access to this environment is denied.' : 'Read access to this environment is denied.',
        );
    }

    c.set('environment', environment);
    await next();
});
