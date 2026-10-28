import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4174';

/** Give each scenario an isolated login-rate-limit identity and disposable API-created records. */
test.beforeEach(async ({ context, page }, testInfo) => {
    const client = createHash('sha256').update(testInfo.testId).digest();

    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.19.${client[0]}.${client[1]}` });
    await page.goto('/');
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
});

/** Seed metadata and return each configuration revision for concurrency assertions. */
async function seed(page: Page, keys: string[] = []) {
    const slug = `actions-${crypto.randomUUID().slice(0, 8)}`;

    const project = await page.request.post('/api/v1/projects', {
        headers: { Origin: origin },
        data: { slug, name: 'Configuration actions' },
    });

    expect(project.status()).toBe(201);

    const created = await page.request.post(`/api/v1/projects/${slug}/environments`, {
        headers: { Origin: origin },
        data: { slug: 'prod', description: 'Production' },
    });

    expect(created.status()).toBe(201);

    const base = `/api/v1/projects/${slug}/environments/prod`;
    const revisions = new Map<string, number>();

    for (const key of keys) {
        const response = await page.request.put(`${base}/configurations/${key}`, {
            headers: { Origin: origin, 'If-None-Match': '*' },
            data: { value: 'original', type: 'text' },
        });

        expect(response.status()).toBe(201);
        revisions.set(key, (await response.json()).revision);
    }

    return { slug, base, revisions };
}

/** Use the account menu so translated controls exercise the real language preference. */
async function chinese(page: Page) {
    await page.getByRole('button', { name: 'User menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
}

test('shows the password notice only on the overview and aligns header borders and API errors', async ({ page }, testInfo) => {
    const { slug } = await seed(page);
    const warning = 'The administrator is still using the initial password.';

    for (const path of ['/projects', '/api-keys', `/projects/${slug}/environments/prod`, '/settings']) {
        await page.goto(path);
        await expect(page.getByRole('banner', { name: 'Titlebar' })).toBeVisible();
        await expect(page.getByRole('banner', { name: 'Titlebar' }).getByText(warning, { exact: true })).toHaveCount(0);

        if (path === '/projects') {
            await expect(page.getByRole('main').getByText(warning, { exact: true })).toBeVisible();
        } else {
            await expect(page.getByText(warning, { exact: true })).toHaveCount(0);
        }
    }

    await page.goto('/projects');

    if (testInfo.project.name === 'desktop') {
        const titlebar = page.getByRole('banner', { name: 'Titlebar' });
        const sidebarHeader = page.locator('[data-sidebar="header"]');

        for (const collapsed of [false, true]) {
            if (collapsed) {
                await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
                await page.mouse.move(800, 80);
            }

            const title = await titlebar.boundingBox();
            const sidebar = await sidebarHeader.boundingBox();

            expect(title!.height).toBe(60);
            expect(Math.abs(title!.y + title!.height - sidebar!.y - sidebar!.height)).toBeLessThan(0.5);
        }
    }

    await expect(page.getByRole('button', { name: 'Create a project', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create project', exact: true })).toHaveCount(1);
    await page.getByRole('main').getByRole('link', { name: 'Change password', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goto('/projects');
    // Return a real API error contract without creating or changing any project.
    await page.route('**/api/v1/projects', async (route) => {
        if (route.request().method() !== 'POST') {
            return route.continue();
        }

        await route.fulfill({
            status: 400,
            json: {
                code: 'invalid_slug',
                message: 'Identifiers may contain only letters, numbers, dots, hyphens, and underscores; . and .. are reserved.',
            },
        });
    });
    await page.getByRole('button', { name: 'Create project', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('Name', { exact: true }).fill('Invalid project');
    await dialog.getByLabel('Slug', { exact: true }).fill('invalid-project');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    const error = dialog.getByRole('alert');

    await expect(error).toHaveText('Identifiers may contain only letters, numbers, dots, hyphens, and underscores; . and .. are reserved.');

    const icon = await error.locator('svg').boundingBox();
    const text = await error.locator('span').boundingBox();

    expect(Math.abs(icon!.y + icon!.height / 2 - text!.y - text!.height / 2)).toBeLessThan(1);
    await page.screenshot({
        path: testInfo.outputPath('centered-api-error.png'),
        animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await chinese(page);
    await expect(page.getByRole('main').getByText('当前管理员仍使用初始密码。', { exact: true })).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('overview-password-notice.png'),
        animations: 'disabled',
    });
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await dialog.getByLabel('名称', { exact: true }).fill('Invalid project');
    await dialog.getByLabel('标识', { exact: true }).fill('invalid-project');
    await dialog.getByRole('button', { name: '创建', exact: true }).click();
    await expect(error).toHaveText('标识只能包含大小写英文字母、数字、点、连字符和下划线；不能单独使用 . 或 ..。');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    // A changed password must remove the reminder without changing real credentials in this test.
    await page.route('**/api/v1/auth/me', (route) =>
        route.fulfill({ json: { username: 'admin', kind: 'user', role: 'admin', defaultPassword: false } }),
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: '项目概览', exact: true })).toBeVisible();
    await expect(page.getByText('当前管理员仍使用初始密码。', { exact: true })).toHaveCount(0);
});

test('creates an explicit all-project token even before projects exist', async ({ page }, testInfo) => {
    await page.route('**/api/v1/projects', (route) => {
        if (route.request().method() !== 'GET') {
            return route.continue();
        }

        return route.fulfill({ json: { items: [], total: 0 } });
    });
    await page.goto('/api-keys');
    await page.getByRole('button', { name: 'Create API token', exact: true }).first().click();

    const form = page.getByRole('main');

    await expect(form.getByRole('combobox', { name: 'Project', exact: true })).toContainText('Select a project');

    const tokenName = `Future applications ${testInfo.project.name}`;

    await form.getByLabel('Name', { exact: true }).fill(tokenName);

    const projectSelect = form.getByRole('combobox', { name: 'Project', exact: true });
    const permissionSelect = form.getByRole('combobox', { name: 'Permission', exact: true });
    const projectBounds = (await projectSelect.boundingBox())!;
    const permissionBounds = (await permissionSelect.boundingBox())!;

    expect(Math.abs(projectBounds.width - permissionBounds.width)).toBeLessThan(1);

    const gridBounds = (await projectSelect.locator('..').locator('..').boundingBox())!;

    expect(Math.abs(projectBounds.x - gridBounds.x)).toBeLessThan(1);
    expect(Math.abs(permissionBounds.x + permissionBounds.width - gridBounds.x - gridBounds.width)).toBeLessThan(1);
    await form.getByRole('combobox', { name: 'Project', exact: true }).click();
    await page.getByRole('option', { name: 'All projects', exact: true }).click();

    const environments = form.getByRole('checkbox', {
        name: 'All environments',
    });

    await expect(environments).toBeChecked();
    await expect(environments).toBeDisabled();
    await expect(form).not.toContainText('including future');
    await expect(form.getByRole('combobox', { name: 'Permission', exact: true })).toContainText('Read');
    await form.getByRole('combobox', { name: 'Permission', exact: true }).click();
    await page.getByRole('option', { name: 'Edit', exact: true }).click();
    await page.screenshot({
        path: testInfo.outputPath('all-projects-token.png'),
        animations: 'disabled',
    });

    const created = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/api-keys') && response.request().method() === 'POST',
    );

    await form.getByRole('button', { name: 'Create API token', exact: true }).click();

    const response = await created;

    expect(response.status()).toBe(201);

    const key = await response.json();

    expect(key.scopes).toEqual([{ project_id: '*', environment_id: '*', permission: 'write' }]);
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    const row = page.getByRole('row').filter({ has: page.getByText(tokenName, { exact: true }) });

    await expect(row).toContainText('All projects');
    await expect(row).toContainText('Edit');
    await chinese(page);
    await expect(row).toContainText('全部项目');
    await expect(row).toContainText('编辑');
    await expect(row).not.toContainText('包括以后');
    await row.getByRole('button', { name: '删除', exact: true }).click();

    const deleting = page.getByRole('dialog', { name: '删除访问令牌', exact: true });

    await deleting.getByRole('button', { name: '确认', exact: true }).click();
    await expect(row).toHaveCount(0);

    const deleted = await page.request.get('/api/v1/projects', {
        headers: { Authorization: `Bearer ${key.token}` },
    });

    expect(deleted.status()).toBe(401);
});

test('shows an existing-configuration error and keeps creation order after editing', async ({ page }) => {
    const { slug, base } = await seed(page, ['z-first', 'a-second']);

    await page.goto(`/projects/${slug}/environments/prod`);

    const region = page.getByRole('region', { name: 'Configuration', exact: true });
    const keys = region.getByRole('button', { name: /^(z-first|a-second)$/ });

    await expect(keys).toHaveText(['z-first', 'a-second']);
    await chinese(page);
    await page.getByRole('button', { name: '新建配置', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('配置 Key', { exact: true }).fill('z-first');
    await dialog.getByLabel('配置内容', { exact: true }).fill('duplicate');

    const failed = page.waitForResponse(
        (response) => response.url().endsWith(`${base}/configurations/z-first`) && response.request().method() === 'PUT',
    );

    await dialog.getByRole('button', { name: '保存配置', exact: true }).click();

    const failure = await failed;

    expect(failure.status()).toBe(409);
    expect(await failure.json()).toMatchObject({ code: 'config_already_exists' });
    await expect(dialog.getByRole('alert')).toHaveText('配置已存在。');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: 'z-first', exact: true }).click();
    await dialog.getByLabel('配置内容', { exact: true }).fill('edited');
    await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(z-first|a-second)$/ })).toHaveText(['z-first', 'a-second']);
});

test('edits boolean literals without enablement or revision labels', async ({ page }, testInfo) => {
    const { slug, base } = await seed(page);

    const created = await page.request.put(`${base}/configurations/feature.enabled`, {
        headers: { Origin: origin, 'If-None-Match': '*' },
        data: { type: 'boolean', value: 'true' },
    });

    expect(created.status()).toBe(201);

    const { revision } = await created.json();

    await page.goto(`/projects/${slug}/environments/prod`);
    await chinese(page);
    await page.getByRole('button', { name: 'feature.enabled', exact: true }).click();

    const dialog = page.getByRole('dialog');
    const boolean = dialog.getByRole('combobox', { name: '布尔值', exact: true });

    await expect(boolean).toHaveText('true');
    await expect(dialog).not.toContainText('基于');
    await boolean.click();
    await expect(page.getByRole('option', { name: 'true', exact: true })).toBeVisible();
    await page.getByRole('option', { name: 'false', exact: true }).click();
    await expect(boolean).toHaveText('false');
    await expect(dialog).not.toContainText('开启');
    await expect(dialog).not.toContainText('关闭');
    await page.screenshot({
        path: testInfo.outputPath('boolean-editor.png'),
        animations: 'disabled',
    });

    const saving = page.waitForResponse(
        (response) => response.url().endsWith(`${base}/configurations/feature.enabled`) && response.request().method() === 'PUT',
    );

    await dialog.getByRole('button', { name: '保存配置', exact: true }).click();

    const saved = await saving;

    expect(saved.status()).toBe(200);
    expect(saved.request().headers()['if-match']).toBe(`"${revision}"`);
    expect((await saved.json()).value).toBe('false');
});

test('selects configuration with Kumo checkboxes and deletes only confirmed records', async ({ page }, testInfo) => {
    const { slug, base, revisions } = await seed(page, ['alpha', 'beta', 'gamma']);

    await page.goto(`/projects/${slug}/environments/prod`);

    const region = page.getByRole('region', { name: 'Configuration', exact: true });
    const all = region.getByRole('checkbox', { name: 'Select all configuration', exact: true });

    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(region.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
    await expect(region.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    const card = (await region.getByTestId('configuration-table-card').boundingBox())!;
    const toolbarSearch = (await region.getByRole('textbox', { name: 'Search configuration keys' }).boundingBox())!;
    const importButton = (await region.getByRole('button', { name: 'Import', exact: true }).boundingBox())!;
    expect(toolbarSearch.y + toolbarSearch.height).toBeLessThan(card.y);
    expect(importButton.y + importButton.height).toBeLessThan(card.y);
    await region.getByRole('checkbox', { name: 'Select alpha', exact: true }).check();
    await expect(all).toBeChecked({ indeterminate: true });
    await expect(region.getByRole('button', { name: 'Delete 1 record', exact: true })).toBeVisible();
    await all.check();
    await expect(region.getByRole('button', { name: 'Delete 3 records', exact: true })).toBeVisible();
    await region.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await expect(all).not.toBeChecked();
    await all.check();

    const search = region.getByRole('textbox', { name: 'Search configuration keys', exact: true });

    await search.fill('alpha');
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(region.getByRole('row')).toHaveCount(2);
    await expect(region.getByRole('button', { name: /Delete \d+ records?/ })).toHaveCount(0);
    await all.check();
    await expect(region.getByText('Selected 1/1', { exact: true })).toBeVisible();
    await region.getByRole('button', { name: 'Delete 1 record', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await page.request.get(`${base}/configurations/alpha`)).status()).toBe(200);
    await search.fill('');
    await expect(region.getByRole('row')).toHaveCount(4);
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await region.getByRole('checkbox', { name: 'Select alpha', exact: true }).check();
    await region.getByRole('checkbox', { name: 'Select beta', exact: true }).check();
    await page.screenshot({
        path: testInfo.outputPath('configuration-selection.png'),
        animations: 'disabled',
    });
    await chinese(page);

    const translated = page.getByRole('region', { name: '配置', exact: true });

    await expect(translated.getByRole('button', { name: '导入', exact: true })).toBeEnabled();
    await expect(translated.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
    await page.screenshot({
        path: testInfo.outputPath('configuration-selection-zh.png'),
        animations: 'disabled',
    });
    await translated.getByRole('button', { name: '删除 2 个记录', exact: true }).click();

    const requests = new Map<string, string | undefined>();

    page.on('request', (request) => {
        if (request.method() === 'DELETE' && request.url().includes(`${base}/configurations/`)) {
            requests.set(new URL(request.url()).pathname.split('/').at(-1)!, request.headers()['if-match']);
        }
    });

    const confirmation = page.getByRole('dialog');

    await confirmation.getByRole('button', { name: '删除 2 个记录', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(translated.getByRole('row')).toHaveCount(2);
    await expect(translated.getByRole('button', { name: 'gamma', exact: true })).toBeVisible();
    expect([...requests.keys()].sort()).toEqual(['alpha', 'beta']);

    for (const key of ['alpha', 'beta']) {
        expect(requests.get(key)).toBe(`"${revisions.get(key)}"`);
        expect((await page.request.get(`${base}/configurations/${key}`)).status()).toBe(404);
    }

    expect((await page.request.get(`${base}/configurations/gamma`)).status()).toBe(200);
});

test('retains failed bulk deletions and protects records changed after confirmation opens', async ({ page }, testInfo) => {
    const { slug, base, revisions } = await seed(page, ['changed', 'removed']);

    await page.goto(`/projects/${slug}/environments/prod`);

    const region = page.getByRole('region', { name: 'Configuration', exact: true });

    await expect(region).toHaveAttribute('aria-busy', 'false');
    await region.getByRole('checkbox', { name: 'Select all configuration', exact: true }).check();
    await region.getByRole('button', { name: 'Delete 2 records', exact: true }).click();

    const changed = await page.request.put(`${base}/configurations/changed`, {
        headers: { Origin: origin, 'If-Match': `"${revisions.get('changed')}"` },
        data: { value: 'updated elsewhere', type: 'text' },
    });

    expect(changed.status()).toBe(200);

    const deletions: string[] = [];

    page.on('request', (request) => {
        if (request.method() === 'DELETE') {
            deletions.push(new URL(request.url()).pathname);
        }
    });

    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'Delete 2 records', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('1 record could not be deleted.');
    await expect(dialog.getByText('The configuration has changed. Reload before saving.', { exact: true })).toBeVisible();
    await expect(dialog.getByText('removed', { exact: true })).toHaveCount(0);
    expect((await page.request.get(`${base}/configurations/removed`)).status()).toBe(404);
    expect(await (await page.request.get(`${base}/configurations/changed`)).json()).toMatchObject({
        value: 'updated elsewhere',
    });
    await page.screenshot({
        path: testInfo.outputPath('partial-deletion.png'),
        animations: 'disabled',
    });
    // Retrying failures must never resend a successful deletion or refresh its revision silently.
    await dialog.getByRole('button', { name: 'Delete 1 record', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(deletions.filter((path) => path.endsWith('/removed'))).toHaveLength(1);
    expect(deletions.filter((path) => path.endsWith('/changed'))).toHaveLength(2);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(region.getByRole('checkbox', { name: 'Select changed', exact: true })).toBeChecked();
    await region.getByRole('button', { name: 'Delete 1 record', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Delete 1 record', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Create your first configuration', exact: true })).toBeVisible();
});

test('exports the complete environment and imports with safe overwrites', async ({ page }, testInfo) => {
    const { slug, base } = await seed(page);
    await page.goto(`/projects/${slug}/environments/prod`);
    const region = page.getByRole('region', { name: 'Configuration', exact: true });
    await expect(region).toHaveAttribute('aria-busy', 'false');

    await region.getByRole('button', { name: 'Export', exact: true }).click();
    const exportPanel = page.getByRole('dialog', { name: 'Export configuration' });
    await expect(exportPanel).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('export-panel.png'), animations: 'disabled' });
    const emptyDownload = page.waitForEvent('download');
    await exportPanel.getByRole('button', { name: 'Export', exact: true }).click();
    expect(JSON.parse(await readFile((await (await emptyDownload).path())!, 'utf8'))).toEqual([]);
    await expect(exportPanel).not.toBeVisible();

    const entries = [
        { key: 'alpha', value: '{"enabled":true}', type: 'json', description: 'First' },
        { key: 'beta', value: 'hello', type: 'text', description: '' },
    ];
    await region.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import configuration' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('import-panel.png'), animations: 'disabled' });
    const dataTransfer = await page.evaluateHandle((contents) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([contents], 'configs.json', { type: 'application/json' }));
        return transfer;
    }, JSON.stringify(entries));
    await dialog.locator('label').dispatchEvent('drop', { dataTransfer });
    await dataTransfer.dispose();
    await expect(dialog.getByText('2 configuration entries ready.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Imported 2 configuration entries.', { exact: true })).toBeVisible();
    await expect(region.getByRole('button', { name: 'alpha', exact: true })).toBeVisible();
    await region.getByRole('textbox', { name: 'Search configuration keys' }).fill('alpha');
    await expect(region.getByRole('row')).toHaveCount(2);
    await region.getByRole('button', { name: 'Export', exact: true }).click();
    const download = page.waitForEvent('download');
    await exportPanel.getByRole('button', { name: 'Export', exact: true }).click();
    const exported = await download;
    expect(exported.suggestedFilename()).toBe(`${slug}-prod-configs.json`);
    expect(JSON.parse(await readFile((await exported.path())!, 'utf8'))).toEqual(entries);

    await region.getByRole('button', { name: 'Import', exact: true }).click();
    await dialog.getByLabel('JSON file').setInputFiles({
        name: 'replacement.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
            JSON.stringify([
                { key: 'alpha', value: 'false', type: 'boolean', description: 'Updated' },
                { key: 'invalid', value: 'not a boolean', type: 'boolean', description: '' },
            ]),
        ),
    });
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Imported 1 configuration entry.');
    await expect(dialog.getByRole('alert')).toContainText('invalid');
    const saved = await (await page.request.get(`${base}/configurations/alpha`)).json();
    expect(saved).toMatchObject({ value: 'false', type: 'boolean', description: 'Updated' });
    expect((await page.request.get(`${base}/configurations/invalid`)).status()).toBe(404);
    await dialog.getByLabel('JSON file').setInputFiles({
        name: 'duplicate.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify([entries[0], entries[0]])),
    });
    await expect(dialog.getByRole('alert')).toHaveText('The file contains duplicate configuration keys.');
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    expect((await (await page.request.get(`${base}/configurations/alpha`)).json()).value).toBe('false');
});
