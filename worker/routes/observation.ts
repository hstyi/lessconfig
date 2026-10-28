import { Hono } from 'hono';
import type { ApiBindings } from '../http';
import { fail, json } from '../common';
import { authenticate } from '../auth';
import { authorizeWatchScopes, parseWatchScopes, initializeWatch, resolveWatchScopes, watchInteger, type WatchRequest } from '../watch';

/** Initialize and observe arbitrary authorized ranges through one GET endpoint. */
export const routes = new Hono<ApiBindings>();

routes.get('/watch', async (c) => {
    // Hono dispatches HEAD through GET handlers; a bodyless request must not open a long poll.
    if (c.req.method !== 'GET') {
        fail(405, 'method_not_allowed', 'This request method is not supported.');
    }

    const parameters = new URL(c.req.url).searchParams;
    const requested = parseWatchScopes(parameters);
    const revision = parameters.has('revision') ? watchInteger(parameters, 'revision') : undefined;
    const timeout = watchInteger(parameters, 'timeout', 60, 300);

    if (timeout < 1) {
        fail(400, 'invalid_watch_parameters', 'timeout must be between 1 and 300 seconds.');
    }

    if (revision === undefined) {
        return json(await initializeWatch(c.env.DB, requested, c.get('principal')));
    }

    const scopes = await resolveWatchScopes(c.env.DB, requested, c.get('principal'));

    const payload: WatchRequest = { scopes, revision, timeout };
    // Internal HTTP transports resolved identities without inflating the public GET URL.
    const response = await c.env.WATCH.getByName('global').fetch(
        new Request('https://coordinator/watch', {
            method: 'POST',
            body: JSON.stringify(payload),
            signal: c.req.raw.signal,
        }),
    );

    if (c.req.raw.signal.aborted) {
        return new Response(null, { status: 499 });
    }

    // Grants can expire or be deleted while a request is suspended. Do not expose its result.
    const principal = await authenticate(c.req.raw, c.env);

    authorizeWatchScopes(principal, scopes);

    return response;
});

routes.all('/watch', () => fail(405, 'method_not_allowed', 'This request method is not supported.'));
