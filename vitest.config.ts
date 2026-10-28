import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/** Run backend tests in workerd with isolated D1 and Durable Object bindings. */
export default defineConfig(async () => ({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
                bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
                d1Databases: ['MIGRATION_DB'],
            },
        }),
    ],
    test: {
        include: ['tests/worker/**/*.test.{ts,js}'],
        setupFiles: ['tests/worker/setup.ts'],
        testTimeout: 20000,
    },
}));
