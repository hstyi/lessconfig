import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';

declare global {
    namespace Cloudflare {
        interface Env {
            TEST_MIGRATIONS: D1Migration[];
            MIGRATION_DB: D1Database;
        }
    }
}

// Migrations run in the test database, never in the developer's persisted workspace.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
