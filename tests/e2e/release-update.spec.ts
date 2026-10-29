import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const endpoint = 'https://api.github.com/repos/lessconfig/lessconfig/releases/latest';
const repository = 'https://github.com/lessconfig/lessconfig';
const { version: currentVersion } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
const latestVersion = `${BigInt(currentVersion.split('.')[0]) + 1n}.10.0`;
const release = {
    tag_name: latestVersion,
    draft: false,
    prerelease: false,
    body: '## Improvements\n\n- Copy configuration keys\n- Fix **configuration downloads**\n\n[Details](https://github.com/lessconfig/lessconfig/issues)\n\n<script>window.releaseScriptRan = true</script>\n\n![tracking](https://example.com/tracking.png)\n\n[unsafe](javascript:alert(1))',
};

/** Isolate update UI from real accounts, GitHub releases, and public API limits. */
test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/auth/me', (route) =>
        route.fulfill({ json: { username: 'admin', kind: 'user', role: 'admin', defaultPassword: false } }),
    );
    await page.route('**/api/v1/projects', (route) => route.fulfill({ json: { items: [], total: 0 } }));
    await page.addInitScript(() => localStorage.setItem('lessconfig.locale', 'zh-CN'));
});

test('offers release notes beside the account menu and links to the matching release', async ({ page }, testInfo) => {
    let checks = 0;
    await page.route(endpoint, (route) => {
        checks++;
        expect(route.request().headers()['authorization']).toBeUndefined();
        expect(route.request().headers()['cookie']).toBeUndefined();
        return route.fulfill({ json: release });
    });

    await page.goto('/projects');
    const titlebar = page.getByRole('banner', { name: '顶栏' });
    const update = titlebar.getByRole('button', { name: '有新版本', exact: true });
    await expect(update).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const updateBounds = (await update.boundingBox())!;
    const accountBounds = (await titlebar.getByRole('button', { name: '用户菜单' }).boundingBox())!;
    expect(updateBounds.x + updateBounds.width).toBeLessThanOrEqual(accountBounds.x);
    await update.click();

    const dialog = page.getByRole('dialog', { name: '发现新版本' });
    await expect(dialog).toContainText(`当前版本：${currentVersion} · 最新版本：${latestVersion}`);
    await expect(dialog.getByRole('heading', { name: 'Improvements' })).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveText(['Copy configuration keys', 'Fix configuration downloads']);
    await expect(dialog.locator('strong')).toHaveText('configuration downloads');
    await expect(dialog.locator('script, img')).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'unsafe', exact: true })).toHaveAttribute('href', '');
    const link = dialog.getByRole('link', { name: '查看 Release' });
    await expect(link).toHaveAttribute('href', `${repository}/releases/tag/${latestVersion}`);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await page.screenshot({ path: testInfo.outputPath('release-notes.png'), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: '关闭', exact: true }).first().click();
    await expect(dialog).toHaveCount(0);
    await expect(update).toBeFocused();
    await page.reload();
    await expect(update).toBeVisible();
    expect(checks).toBe(2);
});

for (const scenario of [
    { name: 'the same version', data: { ...release, tag_name: currentVersion } },
    { name: 'an older version', data: { ...release, tag_name: '0.0.0' } },
    { name: 'a prerelease', data: { ...release, prerelease: true } },
    { name: 'a draft', data: { ...release, draft: true } },
    { name: 'an invalid tag', data: { ...release, tag_name: 'next' } },
    { name: 'no published release', status: 404 },
    { name: 'the GitHub rate limit', status: 403 },
]) {
    test(`keeps the console usable without an update prompt for ${scenario.name}`, async ({ page }) => {
        let checks = 0;
        await page.route(endpoint, (route) => {
            checks++;
            return route.fulfill({ status: scenario.status ?? 200, json: scenario.data ?? { message: 'Unavailable' } });
        });
        const checked = page.waitForResponse(endpoint);
        await page.goto('/projects');
        await expect(page.getByRole('heading', { name: '项目概览', exact: true })).toBeVisible();
        await checked;
        await expect.poll(() => checks).toBe(1);
        await expect(page.getByRole('button', { name: '有新版本', exact: true })).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        const rechecked = page.waitForResponse(endpoint);
        await page.reload();
        await expect(page.getByRole('heading', { name: '项目概览', exact: true })).toBeVisible();
        await rechecked;
        expect(checks).toBe(2);
    });
}

test('shows a fallback for empty release notes', async ({ page }) => {
    await page.route(endpoint, (route) => route.fulfill({ json: { ...release, body: null } }));
    await page.goto('/projects');
    await page.getByRole('button', { name: '有新版本', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '发现新版本' })).toContainText('此版本未提供更新说明。');
});

test('detects a newly published release on reload without reusing the previous result', async ({ page }) => {
    let checks = 0;
    await page.route(endpoint, (route) => {
        checks++;
        return checks === 1 ? route.fulfill({ status: 404, json: { message: 'Not Found' } }) : route.fulfill({ json: release });
    });
    const checked = page.waitForResponse(endpoint);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: '项目概览', exact: true })).toBeVisible();
    await checked;
    await expect(page.getByRole('button', { name: '有新版本', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: '有新版本', exact: true })).toBeVisible();
    expect(checks).toBe(2);
});
