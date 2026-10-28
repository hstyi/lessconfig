import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4174';

/** Authenticate using an isolated rate-limit identity for each browser scenario. */
test.beforeEach(async ({ context, page }, testInfo) => {
    const identity = createHash('sha256').update(testInfo.testId).digest();

    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.20.${identity[0]}.${identity[1]}` });
    await page.goto('/');
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
});

/**
 * Create a configuration through the same public API used by applications.
 * @param page - The authenticated browser and request context.
 * @returns Resource paths and the configuration's initial revision.
 */
async function seed(page: Page) {
    const slug = `watch-ui-${crypto.randomUUID().slice(0, 8)}`;
    const project = await page.request.post('/api/v1/projects', {
        headers: { Origin: origin },
        data: { slug, name: 'Watch integration' },
    });

    expect(project.status()).toBe(201);

    const environment = await page.request.post(`/api/v1/projects/${slug}/environments`, {
        headers: { Origin: origin },
        data: { slug: 'prod' },
    });

    expect(environment.status()).toBe(201);

    const base = `/api/v1/projects/${slug}/environments/prod`;
    const created = await page.request.put(`${base}/configurations/flag`, {
        headers: { Origin: origin, 'If-None-Match': '*' },
        data: { value: 'initial', type: 'text' },
    });

    expect(created.status()).toBe(201);

    return { slug, base, revision: (await created.json()).revision as number };
}

test('keeps the applied revision until a failed watch-triggered reload succeeds', async ({ page }) => {
    const { slug, base, revision } = await seed(page);
    const revisions: number[] = [];
    const steps: string[] = [];
    const watching = page.waitForRequest((request) => {
        const url = new URL(request.url());

        return url.pathname === '/api/v1/watch' && url.searchParams.has('revision');
    });

    page.on('request', (request) => {
        const url = new URL(request.url());

        if (url.pathname === '/api/v1/watch') {
            expect(request.method()).toBe('GET');
            expect(url.searchParams.getAll('scopes')).toEqual([`${slug}/prod`]);
            if (url.searchParams.has('revision')) {
                revisions.push(Number(url.searchParams.get('revision')));
                steps.push('poll');
            } else {
                steps.push('initialize');
            }
        } else if (url.pathname === `${base}/configurations`) {
            steps.push('read');
        }
    });

    await page.goto(`/projects/${slug}/environments/prod`);
    await watching;
    expect(steps).toEqual(['initialize', 'read', 'poll']);

    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'flag', exact: true }) });

    await expect(row.getByText(`v${revision}`, { exact: true })).toBeVisible();

    let failNext = true;

    await page.route(`**${base}/configurations`, async (route) => {
        if (failNext) {
            failNext = false;
            await route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Temporary reload failure.' } });
        } else {
            await route.continue();
        }
    });

    const changed = await page.request.put(`${base}/configurations/flag`, {
        headers: { Origin: origin, 'If-Match': `"${revision}"` },
        data: { value: 'updated', type: 'text' },
    });

    expect(changed.status()).toBe(200);

    const updated = (await changed.json()).revision;

    await expect(page.getByText('Temporary reload failure.', { exact: true })).toBeVisible();
    await expect(row.getByText(`v${revision}`, { exact: true })).toBeVisible();
    expect(revisions).toEqual([revision]);
    await expect(row.getByText(`v${updated}`, { exact: true })).toBeVisible();
    await expect.poll(() => revisions.at(-1)).toBe(updated);
    await expect(page.getByText('Temporary reload failure.', { exact: true })).toHaveCount(0);
});

test('catches a change made while the initial configuration response is in flight', async ({ page }) => {
    const { slug, base, revision } = await seed(page);
    const positions: number[] = [];
    let reads = 0;
    let updated = revision;

    page.on('request', (request) => {
        const url = new URL(request.url());

        if (url.pathname === '/api/v1/watch' && url.searchParams.has('revision')) {
            positions.push(Number(url.searchParams.get('revision')));
        }
    });
    await page.route(`**${base}/configurations`, async (route) => {
        reads++;

        if (reads === 1) {
            const stale = await route.fetch();
            const changed = await page.request.put(`${base}/configurations/flag`, {
                headers: { Origin: origin, 'If-Match': `"${revision}"` },
                data: { value: 'changed during read', type: 'text' },
            });

            expect(changed.status()).toBe(200);
            updated = (await changed.json()).revision;
            await route.fulfill({ response: stale });
        } else {
            await route.continue();
        }
    });
    await page.goto(`/projects/${slug}/environments/prod`);
    await expect.poll(() => reads).toBe(2);
    await expect.poll(() => positions).toEqual([revision, updated]);
    await expect(page.getByRole('row').filter({ hasText: 'flag' }).getByText(`v${updated}`, { exact: true })).toBeVisible();
});

test('reinitializes before reloading when watch history expires and resumes GET polling', async ({ page }) => {
    const { slug, base, revision } = await seed(page);
    let expired = false;
    let reads = 0;
    let watches = 0;
    const steps: string[] = [];

    page.on('request', (request) => {
        if (new URL(request.url()).pathname === `${base}/configurations`) {
            reads++;
            steps.push('read');
        }
    });
    await page.route('**/api/v1/watch?*', async (route) => {
        watches++;
        expect(route.request().method()).toBe('GET');
        const initialized = new URL(route.request().url()).searchParams.has('revision');

        steps.push(initialized ? 'poll' : 'initialize');

        if (initialized && !expired) {
            expired = true;
            await route.fulfill({
                status: 410,
                json: { code: 'revision_expired', message: 'Reload configuration before watching again.' },
            });
        } else {
            await route.continue();
        }
    });
    await page.goto(`/projects/${slug}/environments/prod`);
    await expect.poll(() => reads).toBe(2);
    await expect.poll(() => watches).toBe(4);
    expect(steps).toEqual(['initialize', 'read', 'poll', 'initialize', 'read', 'poll']);
    await expect(page.getByRole('row').filter({ hasText: 'flag' }).getByText(`v${revision}`, { exact: true })).toBeVisible();
    await expect(page.getByText('Watch stopped', { exact: true })).toHaveCount(0);
});
