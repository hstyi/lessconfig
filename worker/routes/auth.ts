import { Hono } from 'hono';
import type { ApiBindings } from '../http';
import { emptyResponse, fail, json } from '../common';
import { changePassword, sessionCookie } from '../auth';
import { deleteSession } from '../session';

/** Route the auth API resources using named path parameters. */
export const routes = new Hono<ApiBindings>();

routes.get('/me', async (c) => {
    const env = c.env;
    const principal = c.get('principal');

    const account =
        principal.kind !== 'key'
            ? await env.DB.prepare('SELECT default_password FROM users WHERE id = ?').bind(principal.userId).first<{
                  default_password: number;
              }>()
            : null;

    return json({
        kind: principal.kind,
        username: principal.name,
        ...(principal.kind === 'key' ? {} : { role: principal.role }),
        defaultPassword: Boolean(account?.default_password),
    });
});

routes.post('/logout', async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const principal = c.get('principal');

    if (principal.kind === 'key') {
        fail(403, 'administrator_required', 'This operation requires an account session.');
    }
    await deleteSession(principal.id, env);

    return emptyResponse(200, { 'Set-Cookie': sessionCookie(request, '', 0) });
});

routes.put('/password', async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const principal = c.get('principal');

    if (principal.kind === 'key') {
        fail(403, 'administrator_required', 'This operation requires an account session.');
    }

    return changePassword(request, env, principal.userId);
});
