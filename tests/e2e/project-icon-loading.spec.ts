import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ context }, testInfo) => {
    const client = createHash('sha256').update(testInfo.testId).digest();

    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.18.${client[0]}.${client[1]}` });
});

const iconPath = (name: string) =>
    readFileSync(`node_modules/@phosphor-icons/core/assets/regular/${name}.svg`, 'utf8').match(/<path d="([^"]+)"/)![1];

async function signIn(page: Page) {
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
}

/** Assert the actual SVG path, not just the persisted name attached to its wrapper. */
async function expectIcon(page: Page, slug: string, name: string, expectedPath: string) {
    const card = page.getByRole('main').getByRole('link').filter({ hasText: slug });
    const path = card.locator(`[data-project-icon="${name}"] path`).first();

    await expect(path).toHaveAttribute('d', expectedPath);
}

test('loads the icon catalog only when a project needs a custom icon', async ({ page }) => {
    const catalogRequests: string[] = [];

    page.on('request', (request) => {
        if (/\/ProjectIconCatalog-[^/]+\.js/.test(new URL(request.url()).pathname)) {
            catalogRequests.push(request.url());
        }
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    expect(catalogRequests).toHaveLength(0);
    await signIn(page);

    const slug = `icon-loading-${crypto.randomUUID().slice(0, 8)}`;
    const created = await page.request.post('/api/v1/projects', {
        headers: { Origin: 'http://127.0.0.1:4174' },
        data: { slug, name: slug },
    });

    expect(created.status()).toBe(201);

    let iconOverride: string | undefined;

    await page.route('**/api/v1/projects', async (route) => {
        const response = await route.fetch();
        const data = await response.json();

        data.items = data.items.filter((project: { slug: string }) => project.slug === slug);

        if (iconOverride && data.items[0]) {
            data.items[0].icon = iconOverride;
        }

        await route.fulfill({ response, json: data });
    });
    catalogRequests.length = 0;
    await page.goto('/projects');
    await expectIcon(page, slug, 'folder-simple', iconPath('folder-simple'));
    expect(catalogRequests).toHaveLength(0);

    const updated = await page.request.patch(`/api/v1/projects/${slug}`, {
        headers: { Origin: 'http://127.0.0.1:4174' },
        data: { name: slug, icon: 'rocket-launch' },
    });

    expect(updated.status()).toBe(200);
    await page.reload();
    await expectIcon(page, slug, 'rocket-launch', iconPath('rocket-launch'));
    expect(catalogRequests.length).toBeGreaterThan(0);

    iconOverride = 'unknown-icon';
    await page.reload();
    await expectIcon(page, slug, 'unknown-icon', iconPath('folder-simple'));
});

test('falls back to the folder icon if the catalog fails to load', async ({ page }) => {
    await signIn(page);

    const slug = `icon-fallback-${crypto.randomUUID().slice(0, 8)}`;
    const created = await page.request.post('/api/v1/projects', {
        headers: { Origin: 'http://127.0.0.1:4174' },
        data: { slug, name: slug, icon: 'rocket-launch' },
    });

    expect(created.status()).toBe(201);
    await page.route('**/assets/ProjectIconCatalog-*.js', (route) => route.abort());
    await page.goto('/projects');
    await expectIcon(page, slug, 'rocket-launch', iconPath('folder-simple'));
});
