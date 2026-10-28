import type { Environment, Principal, Project } from './common';

/** Bind generated Worker resources and request-local authorization state to Hono. */
export type ApiBindings = {
    Bindings: Env;
    Variables: {
        principal: Principal;
        project: Project;
        environment: Environment;
    };
};
