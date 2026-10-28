import { Hono } from 'hono';
import { login } from './auth';
import { errorResponse, fail } from './common';
import type { ApiBindings } from './http';
import { authentication, requestGuard } from './middleware';
import { routes as authRoutes } from './routes/auth';
import { routes as keyRoutes } from './routes/api-keys';
import { routes as projectRoutes } from './routes/projects';
import { routes as observationRoutes } from './routes/observation';
import { scheduled } from './scheduled';

export { WatchCoordinator } from './coordinator';

/** Compose public login and authenticated resource routers under one versioned API. */
const api = new Hono<ApiBindings>();

api.use('*', requestGuard);

api.use('*', authentication);

api.post('/auth/login', (c) => login(c.req.raw, c.env));

api.route('/auth', authRoutes);

api.route('/api-keys', keyRoutes);

api.route('/projects', projectRoutes);

api.route('/', observationRoutes);

/** Preserve one English error contract for middleware, routes, and unknown endpoints. */
const app = new Hono<ApiBindings>();

app.onError((error) => errorResponse(error));

app.notFound(() => fail(404, 'endpoint_not_found', 'The endpoint does not exist.'));

app.route('/api/v1', api);

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
