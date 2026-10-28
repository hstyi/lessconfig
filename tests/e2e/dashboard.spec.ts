import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/** Give each browser scenario its own client IP without weakening the production login limiter. */
test.beforeEach(async ({ context }, testInfo) => {
    const client = createHash('sha256').update(testInfo.testId).digest();

    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.18.${client[0]}.${client[1]}` });
});

/** Sign in through the same form used by the administrator. */
async function signIn(page: Page) {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
}

/** Seed a unique project through the API without touching the development database. */
async function seedProject(page: Page) {
    const slug = `e2e-${crypto.randomUUID().slice(0, 8)}`;
    const headers = { Origin: 'http://127.0.0.1:4174' };

    const project = await page.request.post('/api/v1/projects', {
        headers,
        data: { slug, name: `Payments ${slug}` },
    });

    expect(project.status()).toBe(201);

    const environment = await page.request.post(`/api/v1/projects/${slug}/environments`, {
        headers,
        data: { slug: 'prod', description: 'Production' },
    });

    expect(environment.status()).toBe(201);

    return { slug, project: await project.json(), environment: await environment.json() };
}

test('derives project environment counts from shared environment lists', async ({ page }) => {
    await signIn(page);

    const { slug, project } = await seedProject(page);
    const path = `**/api/v1/projects/${slug}/environments`;
    let requests = 0;
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });

    await page.route(path, async (route) => {
        requests += 1;
        await pending;
        await route.continue();
    });
    await page.reload();

    const main = page.getByRole('main');
    const card = main.getByRole('link').filter({ has: page.getByRole('heading', { name: project.name, exact: true }) });
    const total = main.getByText('Environment', { exact: true }).locator('..').locator('strong');

    await expect(card.getByText('Loading environments…')).toBeVisible();
    await expect(total).toHaveText('—');
    release();
    await expect(card.getByText('1 environment', { exact: true })).toBeVisible();
    await expect(total).not.toHaveText('—');
    await card.click();
    await expect(page.getByText('prod', { exact: true }).first()).toBeVisible();
    expect(requests).toBe(1);

    await page.unroute(path);
    await page.route(path, (route) => route.fulfill({ status: 500, json: { error: { message: 'Failed' } } }));
    await page.goto('/projects');
    await page.reload();
    await expect(card.getByText('Unable to load environments')).toBeVisible();
    await expect(total).toHaveText('—');
});

test('derives environment configuration counts from configuration lists', async ({ page }) => {
    await signIn(page);

    const { slug } = await seedProject(page);
    const path = `/api/v1/projects/${slug}/environments/prod/configurations`;
    const emptyEnvironment = await page.request.post(`/api/v1/projects/${slug}/environments`, {
        headers: { Origin: 'http://127.0.0.1:4174' },
        data: { slug: 'empty' },
    });
    const created = await page.request.put(`${path}/flag`, {
        headers: { Origin: 'http://127.0.0.1:4174', 'If-None-Match': '*' },
        data: { value: 'yes', type: 'text' },
    });

    expect(emptyEnvironment.status()).toBe(201);
    expect(created.status()).toBe(201);

    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });

    await page.route(`**${path}`, async (route) => {
        await pending;
        await route.continue();
    });
    await page.goto(`/projects/${slug}`);

    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'prod', exact: true }) });
    const emptyRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'empty', exact: true }) });

    await expect(row.getByLabel('Loading configuration count…')).toBeVisible();
    await expect(emptyRow.getByText('0 items', { exact: true })).toBeVisible();
    release();
    await expect(row.getByText('1 item', { exact: true })).toBeVisible();

    await page.unroute(`**${path}`);
    await page.route(`**${path}`, (route) => route.fulfill({ status: 500, json: { message: 'Failed' } }));
    await page.reload();
    await expect(row.getByText('Unable to load configuration count')).toBeVisible();
});

/** Change language from the same account menu used on desktop and mobile. */
async function selectChinese(page: Page) {
    await page.getByRole('button', { name: 'User menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
}

/** Project icons persist across views; external sidebar links retain native new-tab behavior. */
test('chooses and edits project icons and opens sidebar external links', async ({ page }, testInfo) => {
    await signIn(page);

    const slug = `icons-${crypto.randomUUID().slice(0, 8)}`;
    const name = `Icon project ${slug}`;

    await page.getByRole('button', { name: 'Create project', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Create project', exact: true });
    const trigger = dialog.getByRole('button', { name: 'Project icon', exact: true });

    await expect(trigger.locator('[data-project-icon="folder-simple"]')).toBeVisible();

    const nameInput = await dialog.getByLabel('Name', { exact: true }).boundingBox();
    const iconButton = await trigger.boundingBox();

    expect(nameInput).not.toBeNull();
    expect(iconButton).not.toBeNull();
    expect(Math.abs(nameInput!.y - iconButton!.y)).toBeLessThan(2);
    expect(iconButton!.x + iconButton!.width).toBeLessThan(nameInput!.x);
    await trigger.click();

    const picker = page.getByTestId('project-icon-picker');

    await expect(picker.getByRole('button', { name: 'Folder simple', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const grid = picker.getByRole('grid', { name: 'Available icons', exact: true });

    await expect(grid).toHaveAttribute('aria-rowcount', '252');
    expect(await grid.getByRole('button').count()).toBeLessThan(90);
    await expect.poll(() => grid.locator('svg[data-project-icon]').count()).toBeGreaterThan(24);
    await page.screenshot({
        path: testInfo.outputPath('full-icon-catalog.png'),
        animations: 'disabled',
    });
    await grid.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expect(picker.getByRole('button', { name: 'Youtube logo', exact: true })).toBeVisible();
    expect(await grid.getByRole('button').count()).toBeLessThan(90);
    await picker.getByRole('button', { name: 'Youtube logo', exact: true }).focus();
    await page.keyboard.press('Home');
    await expect(picker.getByRole('button', { name: 'Acorn', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await expect(picker.getByRole('button', { name: 'Youtube logo', exact: true })).toBeFocused();
    await picker.getByRole('textbox', { name: 'Search icons', exact: true }).fill('thunderstorm');
    await expect(picker.getByRole('button', { name: 'Cloud lightning', exact: true })).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search icons', exact: true }).fill('CloudLightning');
    await expect(grid.getByRole('button')).toHaveCount(1);
    await expect(grid.locator('[data-project-icon="cloud-lightning"]')).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('project-icon-picker.png'),
        animations: 'disabled',
    });
    await picker.getByRole('textbox', { name: 'Search icons', exact: true }).fill('unknown-icon');
    await expect(picker.getByText('No matching icons', { exact: true })).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search icons', exact: true }).fill('cloud');
    await picker.getByRole('button', { name: 'Cloud', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Slug', { exact: true }).fill(slug);
    await page.screenshot({
        path: testInfo.outputPath('project-details.png'),
        animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
    expect((await (await page.request.get(`/api/v1/projects/${slug}`)).json()).icon).toBe('cloud');
    await page.reload();
    await page.getByRole('button', { name: 'Edit project', exact: true }).click();

    const edit = page.getByRole('dialog', { name: 'Edit project', exact: true });

    await expect(edit.getByRole('button', { name: 'Project icon', exact: true }).locator('[data-project-icon="cloud"]')).toBeVisible();

    const editIcon = (await edit.getByRole('button', { name: 'Project icon', exact: true }).boundingBox())!;

    const editName = (await edit.getByLabel('Name', { exact: true }).boundingBox())!;

    expect(Math.abs(editIcon.y - editName.y)).toBeLessThan(2);
    expect(editIcon.x + editIcon.width).toBeLessThan(editName.x);
    await edit.getByRole('button', { name: 'Project icon', exact: true }).click();
    await picker.getByRole('textbox', { name: 'Search icons', exact: true }).fill('rocket-launch');
    await picker.getByRole('button', { name: 'Rocket launch', exact: true }).focus();
    await page.keyboard.press('Enter');
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(edit).toHaveCount(0);
    await page.goto('/projects');

    const card = page
        .getByRole('main')
        .getByRole('link')
        .filter({ has: page.getByRole('heading', { name, exact: true }) });

    await expect(card.locator('[data-project-icon="rocket-launch"]')).toBeVisible();

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });

    await expect(nav.getByRole('button', { name, exact: true }).locator('[data-project-icon="rocket-launch"]')).toBeVisible();
    // Stub the external destination while preserving the browser's real anchor and popup behavior.
    await page
        .context()
        .route('https://www.baidu.com/**', (route) =>
            route.fulfill({ contentType: 'text/html', body: '<title>External destination</title>' }),
        );

    for (const label of ['GitHub', 'Sponsor']) {
        const link = nav.getByRole('link', { name: label, exact: true });

        await expect(link).toHaveAttribute('href', 'https://www.baidu.com');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);

        const opened = page.waitForEvent('popup');

        await link.click();

        const popup = await opened;

        await expect(popup).toHaveURL('https://www.baidu.com/');
        await popup.close();
    }

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Close navigation' }).click();
    }

    await selectChinese(page);
    await card.click();
    await page.getByRole('button', { name: '编辑项目', exact: true }).click();
    await page.getByRole('button', { name: '项目图标', exact: true }).click();
    await picker.getByRole('textbox', { name: '搜索图标', exact: true }).fill('数据库');
    await picker.getByRole('button', { name: '数据库', exact: true }).click();
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await (await page.request.get(`/api/v1/projects/${slug}`)).json()).icon).toBe('database');
});

/** Keep the dashboard-style login responsive while preserving translated authentication. */
test('shows a Cloudflare-style sign-in layout and a plain translated sign-in button', async ({ page }, testInfo) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();

    const form = page.locator('form');
    const button = form.getByRole('button', { name: 'Sign in', exact: true });

    await expect(button.locator('svg')).toHaveCount(0);
    await expect(
        page.getByText('One administrator. All configuration accessible through the API.', {
            exact: true,
        }),
    ).toHaveCount(0);

    const bounds = (await form.boundingBox())!;
    const panel = (await page.getByRole('main').locator('section').boundingBox())!;
    const viewport = page.viewportSize()!;

    expect(bounds.width).toBeLessThanOrEqual(384);
    expect(bounds.x).toBeGreaterThanOrEqual(20);

    const brand = (await page.getByRole('link', { name: 'lessconfig', exact: true }).boundingBox())!;

    expect(brand.y + brand.height).toBeLessThan(bounds.y);

    const presentation = page.getByTestId('login-artwork');

    if (testInfo.project.name === 'desktop') {
        expect(bounds.x).toBeGreaterThan(viewport.width / 2);
        expect(brand.x).toBeGreaterThanOrEqual(viewport.width / 2);
        await expect(presentation).toBeVisible();
        const artworkBounds = (await presentation.boundingBox())!;
        expect(artworkBounds.x + artworkBounds.width).toBeLessThanOrEqual(panel.x);
    } else {
        expect(Math.abs(panel.x + panel.width / 2 - viewport.width / 2)).toBeLessThan(1);
        await expect(presentation).toBeHidden();
    }

    const language = page.getByRole('button', { name: 'Language', exact: true });
    const languageBounds = (await language.boundingBox())!;

    expect(languageBounds.x).toBeGreaterThanOrEqual(brand.x + brand.width);
    expect(viewport.width - (languageBounds.x + languageBounds.width)).toBeLessThanOrEqual(32);
    expect(Math.abs(languageBounds.y + languageBounds.height / 2 - (brand.y + brand.height / 2))).toBeLessThan(1);
    const headingBounds = (await page.getByRole('heading', { name: 'Sign in' }).boundingBox())!;
    expect((headingBounds.y + bounds.y + bounds.height) / 2).toBeLessThan(viewport.height / 2);
    await expect(page.getByRole('link', { name: 'lessconfig', exact: true }).locator('svg')).toBeVisible();
    expect(await page.locator('html').evaluate((element) => element.scrollWidth)).toBe(viewport.width);
    await language.click();
    await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
    await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.getByText('登录控制台', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('login-layout.png'), animations: 'disabled' });
    await page.getByLabel('密码', { exact: true }).fill('incorrect-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('密码', { exact: true }).fill('admin');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
});

/** Highlighted editors must preserve configuration content across type changes and saves. */
test('edits JSON, YAML, and Properties with syntax highlighting', async ({ page }, testInfo) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await signIn(page);

    const { slug } = await seedProject(page);

    await page.goto(`/projects/${slug}/environments/prod`);

    for (const example of [
        {
            type: 'JSON',
            key: 'application.json',
            value: '{\n  "message": "你好",\n  "port": 8080\n}\n',
            token: '.tok-string',
        },
        {
            type: 'YAML',
            key: 'application.yml',
            value: '# Server settings\nserver:\n  port: 8080\n  name: "你好"\n',
            token: '.tok-comment',
        },
        {
            type: 'Properties',
            key: 'application.properties',
            value: '# Server settings\nserver.port=8080\nserver.name=你好\n',
            token: '.tok-comment',
        },
    ]) {
        await page.getByRole('button', { name: 'Create configuration', exact: true }).first().click();

        const dialog = page.getByRole('dialog');

        await dialog.getByLabel('Configuration key', { exact: true }).fill(example.key);
        await dialog.getByLabel('Content type', { exact: true }).click();
        await page.getByRole('option', { name: example.type, exact: true }).click();

        const editor = dialog.getByRole('textbox', { name: 'Value', exact: true });

        await expect(editor).toHaveCSS('padding-top', '0px');
        await expect(editor).toHaveCSS('padding-bottom', '0px');

        if (example.type === 'JSON') {
            const scroller = dialog.locator('.cm-scroller');

            await editor.click();

            const shortHeight = await scroller.evaluate((element) => element.getBoundingClientRect().height);

            await expect(dialog.locator('.cm-editor')).toHaveCSS('outline-style', 'none');
            await editor.fill(Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n'));
            expect(await scroller.evaluate((element) => element.getBoundingClientRect().height)).toBe(shortHeight);
            expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
        }

        await editor.fill(example.value);
        await expect(editor.locator('.cm-line').first()).toHaveCSS('padding-left', '6px');
        await expect(editor.locator('.cm-line').first()).toHaveCSS('padding-right', '6px');
        await expect(editor).toHaveCSS('font-size', '14px');
        await expect(editor).toHaveCSS('line-height', '24px');
        await expect(editor.locator(example.token).first()).toBeVisible();

        const color = await editor.evaluate((element) => getComputedStyle(element).color);

        await expect(editor.locator(example.token).first()).not.toHaveCSS('color', color);
        await expect(dialog.getByText('UTF-8', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Original formatting', { exact: false })).toHaveCount(0);
        // Reconfiguring the language must preserve the current editor DOM and buffer.
        await editor.evaluate((element) => {
            element.dataset.buffer = 'preserved';
        });
        await dialog.getByLabel('Content type', { exact: true }).click();
        await page.getByRole('option', { name: 'Text', exact: true }).click();
        await expect(editor.locator('[class*="tok-"]')).toHaveCount(0);
        await expect(editor).toHaveAttribute('data-buffer', 'preserved');
        await dialog.getByLabel('Content type', { exact: true }).click();
        await page.getByRole('option', { name: example.type, exact: true }).click();
        await expect(editor.locator(example.token).first()).toBeVisible();

        if (example.type === 'YAML') {
            // Wait for the dialog's opening transition before capturing the editor.
            await expect(dialog).toHaveCSS('opacity', '1');
            await page.screenshot({
                path: testInfo.outputPath('syntax-editor.png'),
                animations: 'disabled',
            });
        }

        await dialog.getByRole('button', { name: 'Save configuration', exact: true }).click();
        await expect(dialog).toHaveCount(0);

        const response = await page.request.get(`/api/v1/projects/${slug}/environments/prod/configurations/${example.key}`);

        expect(response.status()).toBe(200);
        expect((await response.json()).value).toBe(example.value);
        await page.getByRole('button', { name: example.key, exact: true }).click();
        await expect(dialog.getByRole('textbox', { name: 'Value', exact: true })).toContainText('你好');
        await expect(dialog.getByRole('textbox', { name: 'Value', exact: true })).toHaveCSS('padding-top', '0px');
        await expect(dialog.locator(example.token).first()).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }

    expect(errors).toEqual([]);
});

/** Gutter numbers must stay visible and aligned after scrolling newly created and saved content. */
test('keeps line numbers visible when scrolling new and existing configuration', async ({ page }, testInfo) => {
    await signIn(page);

    const { slug } = await seedProject(page);

    await page.goto(`/projects/${slug}/environments/prod`);
    await page.getByRole('button', { name: 'Create configuration', exact: true }).first().click();

    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('Configuration key', { exact: true }).fill('scrolling.txt');
    await dialog.getByLabel('Content type', { exact: true }).click();
    await page.getByRole('option', { name: 'Text', exact: true }).click();

    const content = Array.from({ length: 300 }, (_, index) => `setting_${index + 1}=value`).join('\n');

    await dialog.getByRole('textbox', { name: 'Value', exact: true }).fill(content);

    for (const mode of ['new', 'edit']) {
        const scroller = dialog.locator('.cm-scroller');

        await scroller.scrollIntoViewIfNeeded();

        const numbers = dialog.locator('.cm-lineNumbers');

        await scroller.evaluate((element) => {
            element.scrollTop = 0;
        });
        await expect(numbers.getByText('1', { exact: true })).toBeInViewport();
        await scroller.evaluate((element) => {
            element.scrollTop = 149 * 24;
        });
        await expect(numbers.getByText('153', { exact: true })).toBeInViewport();
        await scroller.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });

        const lastNumber = numbers.getByText('300', { exact: true });

        await expect(lastNumber).toBeInViewport();

        const lastLine = dialog.locator('.cm-line').filter({ hasText: /^setting_300=value$/ });

        await expect(lastLine).toBeInViewport();
        expect(Math.abs((await lastNumber.boundingBox())!.y - (await lastLine.boundingBox())!.y)).toBeLessThan(1);

        if (mode === 'new') {
            await dialog.getByRole('button', { name: 'Save configuration', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            await page.getByRole('button', { name: 'scrolling.txt', exact: true }).click();
        }
    }

    await page.screenshot({
        path: testInfo.outputPath('editor-gutter-scroll.png'),
        animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

/** The settings group exposes each destination and the workspace transfer controls. */
test('groups settings pages and centers token guidance without page footers', async ({ page }, testInfo) => {
    await signIn(page);
    await seedProject(page);
    await page.reload();

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });

    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible();

    const group = navigation.locator('[data-sidebar=group]').filter({ has: page.getByText('Settings', { exact: true }) });

    await expect(group.getByRole('link', { name: 'API Tokens', exact: true })).toBeVisible();
    await expect(group.getByRole('link', { name: 'Account Settings', exact: true })).toBeVisible();
    await group.getByRole('link', { name: 'Import / Export', exact: true }).click();
    await expect(page).toHaveURL(/\/import-export$/);
    await expect(page.getByRole('heading', { name: 'Import / Export', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Export workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('main').locator('footer')).toHaveCount(0);
    await selectChinese(page);
    await expect(page.getByRole('heading', { name: '导入导出', exact: true })).toBeVisible();
    await page.goto('/api-keys');

    const guidance = page.getByText(
        '读取允许获取配置和监听变化；编辑还允许创建、修改、删除配置。只有管理员可以管理项目、环境和 访问令牌。',
        { exact: true },
    );

    await expect(guidance).toBeVisible();

    const alignment = await guidance.evaluate((element) => {
        const text = element.getBoundingClientRect();
        const icon = element.parentElement!.querySelector('svg')!.getBoundingClientRect();
        const panel = element.parentElement!.getBoundingClientRect();

        return {
            icon: Math.abs(text.y + text.height / 2 - icon.y - icon.height / 2),
            text: Math.abs(text.y + text.height / 2 - panel.y - panel.height / 2),
        };
    });

    expect(alignment.icon).toBeLessThanOrEqual(1);
    expect(alignment.text).toBeLessThanOrEqual(1);
    await expect(page.getByRole('main').locator('footer')).toHaveCount(0);
    await page.screenshot({
        path: testInfo.outputPath('settings-navigation.png'),
        animations: 'disabled',
    });
});

/** A per-key history dialog and the global tab share records and read-only diff behavior. */
test('shows filtered configuration history with highlighted diffs and restores deleted content', async ({ page }, testInfo) => {
    await signIn(page);

    const { slug } = await seedProject(page);
    const base = `/api/v1/projects/${slug}/environments/prod`;
    const headers = { Origin: 'http://127.0.0.1:4174' };

    const first = await page.request.put(`${base}/configurations/application.yml`, {
        headers: { ...headers, 'If-None-Match': '*' },
        data: { type: 'yaml', value: 'server:\n  port: 8080\n' },
    });

    const original = await first.json();

    const second = await page.request.put(`${base}/configurations/application.yml`, {
        headers: { ...headers, 'If-Match': `"${original.revision}"` },
        data: { type: 'yaml', value: 'server:\n  port: 9090\n' },
    });

    const updated = await second.json();

    await page.request.put(`${base}/configurations/other`, {
        headers: { ...headers, 'If-None-Match': '*' },
        data: { type: 'text', value: 'unrelated' },
    });
    await page.goto(`/projects/${slug}/environments/prod`);

    const keyHistory = page.waitForResponse(
        (response) => response.url().endsWith(`${base}/configurations/application.yml/history`) && response.request().method() === 'GET',
    );

    await page.getByRole('button', { name: 'History for application.yml', exact: true }).click();
    expect((await keyHistory).status()).toBe(200);

    const historyDialog = page.getByRole('dialog', {
        name: 'History for application.yml',
        exact: true,
    });

    await expect(historyDialog.getByRole('row')).toHaveCount(3);
    await expect(historyDialog.getByRole('cell', { name: 'other', exact: true })).toHaveCount(0);
    await historyDialog.getByRole('button', { name: 'View version', exact: true }).first().click();

    const versionDialog = page.getByRole('dialog').filter({ has: page.getByTestId('history-diff') });
    const diff = versionDialog.getByTestId('history-diff');

    await expect(diff).toContainText('8080');
    await expect(diff).toContainText('9090');
    await expect(diff.locator('.cm-deletedChunk')).toBeVisible();
    await expect(diff.locator('.cm-changedLine')).toBeVisible();
    await expect(diff.locator('[class*="tok-"]').first()).toBeVisible();
    await expect(diff.locator('[contenteditable=true]')).toHaveCount(0);
    await expect(versionDialog.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
    await expect(versionDialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('history-diff.png'), animations: 'disabled' });
    await versionDialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(historyDialog).toBeVisible();
    await historyDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('tab', { name: 'History', exact: true }).click();

    const history = page.getByRole('region', { name: 'Configuration history', exact: true });

    await expect(history.getByRole('row')).toHaveCount(4);
    await history.getByRole('button', { name: 'View version', exact: true }).last().click();
    await expect(diff).toContainText('8080');
    await expect(diff.locator('.cm-deletedLine')).toHaveCount(0);
    await versionDialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    expect(
        (
            await page.request.delete(`${base}/configurations/application.yml`, {
                headers: { ...headers, 'If-Match': `"${updated.revision}"` },
            })
        ).status(),
    ).toBe(200);
    await expect(history.getByRole('row')).toHaveCount(5);
    await history.getByRole('button', { name: 'View version', exact: true }).first().click();
    await expect(diff.locator('.cm-deletedChunk')).toContainText('9090');
    await versionDialog.getByRole('button', { name: 'Restore this version', exact: true }).click();
    await expect(versionDialog).toHaveCount(0);

    const restored = await page.request.get(`${base}/configurations/application.yml`);

    expect((await restored.json()).value).toBe('server:\n  port: 9090\n');
});

/** Environment remarks never replace identifiers in navigation or client endpoints. */
test('edits environment remarks and opens the standalone integration guide in the restored wide layout', async ({ page }, testInfo) => {
    await signIn(page);

    const { slug, project } = await seedProject(page);

    if (testInfo.project.name === 'desktop') {
        await page.setViewportSize({ width: 2048, height: 1100 });
    }

    await page.reload();

    const createItem = page.getByRole('button', {
        name: 'Create a project',
        exact: true,
    });

    await expect(createItem).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create project', exact: true })).toHaveCount(1);

    if (testInfo.project.name === 'desktop') {
        const width = await page.getByRole('main').evaluate((element) => {
            const style = getComputedStyle(element);

            return element.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        });

        expect(width).toBe(1596);
    }

    await page.goto(`/projects/${slug}/environments/prod`);
    await page.getByRole('button', { name: 'Edit environment', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog.getByLabel('Identifier', { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Identifier', { exact: true })).toHaveValue('prod');
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveCount(0);
    await dialog.getByLabel('Remarks (optional)', { exact: true }).fill('Production notes · 生产备注');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'prod', exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText('Production notes · 生产备注')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'API integration', exact: true })).toHaveCount(0);

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    await page.getByRole('navigation').getByRole('link', { name: 'Integration Guide', exact: true }).click();
    await expect(page).toHaveURL(/\/integration$/);
    await expect(page.getByRole('heading', { name: 'Integration Guide', exact: true })).toBeVisible();

    for (const label of ['Project', 'Environment']) {
        const bounds = await page.getByRole('combobox', { name: label, exact: true }).boundingBox();

        expect(bounds!.width).toBeGreaterThan(300);
    }

    const projectBounds = (await page.getByRole('combobox', { name: 'Project', exact: true }).boundingBox())!;

    const environmentBounds = (await page.getByRole('combobox', { name: 'Environment', exact: true }).boundingBox())!;

    const cards = page.getByRole('main').locator('section');
    const firstCard = (await cards.first().boundingBox())!;
    const lastCard = (await cards.last().boundingBox())!;

    expect(Math.abs(projectBounds.width - environmentBounds.width)).toBeLessThan(1);
    expect(Math.abs(projectBounds.x - firstCard.x)).toBeLessThan(1);
    expect(Math.abs(environmentBounds.x + environmentBounds.width - lastCard.x - lastCard.width)).toBeLessThan(1);
    await page.getByLabel('Project', { exact: true }).click();
    await page.getByRole('option', { name: project.name, exact: true }).click();
    const examples = page.getByRole('main').locator('pre');

    await expect(examples.nth(0)).toContainText(`/watch?scopes=${slug}%2Fprod`);
    await expect(examples.nth(0)).not.toContainText('revision=');
    await expect(examples.nth(1)).toContainText(`/projects/${slug}/environments/prod/configurations`);
    await expect(examples.nth(2)).toContainText(`scopes=${slug}%2Fprod&revision=<REVISION>`);
    await selectChinese(page);
    await expect(page.getByRole('heading', { name: '接入指南', exact: true })).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('integration-guide.png'),
        animations: 'disabled',
        fullPage: true,
    });
});

test('matches an English browser and persists the selected interface language', async ({ page }, testInfo) => {
    await signIn(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('My workspace', { exact: true })).toHaveCount(0);
    expect(await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('oklch(0.9875 0 0)');
    await page.evaluate(() => {
        document.documentElement.dataset.accountNavigation = 'preserved';
    });
    await page.getByRole('button', { name: 'User menu', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'admin', exact: true })).toBeDisabled();
    await page.getByRole('menuitem', { name: 'Account Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    expect(await page.locator('html').getAttribute('data-account-navigation')).toBe('preserved');
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await selectChinese(page);
    await expect(page.getByRole('heading', { name: '项目概览', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '项目概览', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: '打开导航' }).click();
        await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
        await page.getByRole('link', { name: '账户设置', exact: true }).click();
        await expect(page.getByRole('heading', { name: '账户设置', exact: true })).toBeVisible();
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
});

test('creates configuration, edits it, and displays its history', async ({ page }, testInfo) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await signIn(page);

    const slug = `ui-${crypto.randomUUID().slice(0, 8)}`;

    await page.getByRole('button', { name: 'Create project', exact: true }).last().click();

    let dialog = page.getByRole('dialog');

    await dialog.getByLabel('Name', { exact: true }).fill('Checkout');
    await dialog.getByLabel('Slug', { exact: true }).fill(slug);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create environment', exact: true }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Remarks (optional)', { exact: true }).fill('Production');
    await dialog.getByLabel('Identifier', { exact: true }).fill('prod');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Create configuration', exact: true }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Configuration key', { exact: true }).fill('feature.enabled');
    await dialog.getByLabel('Value', { exact: true }).fill('YES');
    await dialog.getByRole('button', { name: 'Save configuration' }).click();
    await expect(page.getByRole('button', { name: 'feature.enabled', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'feature.enabled', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Value', { exact: true })).toHaveText('YES');
    await dialog.getByLabel('Value', { exact: true }).fill('NO');
    await dialog.getByRole('button', { name: 'Save configuration' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByRole('cell', { name: 'feature.enabled', exact: true })).toHaveCount(2);
    await page.getByRole('button', { name: 'View version' }).first().click();
    await expect(page.getByTestId('history-diff')).toContainText('YES');
    await expect(page.getByTestId('history-diff')).toContainText('NO');
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({
        path: testInfo.outputPath('configuration.png'),
        fullPage: true,
        animations: 'disabled',
    });
    await page.getByRole('tab', { name: 'Configuration', exact: false }).click();
    await page.getByRole('button', { name: 'User menu', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('dashboard-menu.png'),
        fullPage: true,
        animations: 'disabled',
    });
    expect(errors).toEqual([]);
});

test('creates a scoped Read token directly with calendar expiration', async ({ page }, testInfo) => {
    await signIn(page);

    const { project, environment } = await seedProject(page);

    await page.goto('/api-keys');
    await page.getByRole('button', { name: 'Create API token', exact: true }).first().click();
    await expect(page).toHaveURL(/\/api-keys\/new$/);

    const form = page.getByRole('main');
    const tokenName = `Checkout service ${project.id}`;

    await form.getByLabel('Name', { exact: true }).fill(tokenName);
    await form.getByRole('button', { name: 'Expiration (optional)' }).click();
    await expect(page.getByText('Expiration date', { exact: true })).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('calendar.png'),
        fullPage: true,
        animations: 'disabled',
    });
    // Clear and reselect a date without introducing a time field or shifting the selected day.
    await page.getByTestId('expiration-calendar').locator('[data-day] button:not([disabled])').first().click();

    const expiration = form.getByRole('button', { name: 'Expiration (optional)' });

    await expect(expiration).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    await expiration.click();
    await page.getByRole('button', { name: 'No expiration', exact: true }).click();
    await expect(expiration).toHaveText('Select date');
    await expiration.click();

    const selectedDay = page.getByTestId('expiration-calendar').locator('[data-day]:has(button:not([disabled]))').first();

    const expectedDate = await selectedDay.getAttribute('data-day');

    await selectedDay.getByRole('button').click();
    await expect(expiration).toHaveText(expectedDate!);
    await expect(form.locator('input[type="time"]')).toHaveCount(0);
    await form.getByRole('combobox', { name: 'Project', exact: true }).click();
    // Match the unique resource created by this test.
    await page.getByRole('option', { name: project.name, exact: true }).last().click();
    await form.getByRole('checkbox', { name: 'prod · Production', exact: true }).check();
    await expect(form.getByRole('combobox', { name: 'Permission', exact: true })).toContainText('Read');
    await page.screenshot({
        path: testInfo.outputPath('api-key-form.png'),
        fullPage: true,
        animations: 'disabled',
    });

    const created = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/api-keys') && response.request().method() === 'POST',
    );

    await form.getByRole('button', { name: 'Create API token', exact: true }).click();

    const response = await created;

    expect(response.status()).toBe(201);

    const key = await response.json();

    expect(key.expires_at).toBe(expectedDate);
    expect(response.request().postDataJSON().expires_at).toBe(expectedDate);
    // UI scope selection must produce the documented resource grant.
    expect(key.scopes[0].permission).toBe('read');
    expect(key.scopes[0].environment_id).toBe(environment.id);
    expect(key.scopes[0].project_id).toBe(project.id);
    await expect(page.getByRole('heading', { name: 'API token created' })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    const tokenRow = page.getByRole('row').filter({ has: page.getByText(tokenName, { exact: true }) });

    await expect(tokenRow.getByRole('cell', { name: expectedDate!, exact: true })).toBeVisible();
    await expect(tokenRow.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText(key.token, { exact: true })).toHaveCount(0);
    await selectChinese(page);
    await expect(page.getByRole('heading', { name: '访问令牌', exact: true })).toBeVisible();
    await expect(page.getByText('读取', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '创建令牌', exact: true }).first().click();
    await page.getByRole('combobox', { name: '权限', exact: true }).click();
    await expect(page.getByRole('option', { name: '读取', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '编辑', exact: true })).toBeVisible();
});

test('cancels a pending HTTP watch and can reconnect afterward', async ({ page }) => {
    await signIn(page);

    const { slug } = await seedProject(page);
    const scope = `${slug}/prod`;
    const initial = await page.request.get(`/api/v1/watch?scopes=${encodeURIComponent(scope)}`);
    const { revision } = await initial.json();

    const result = await page.evaluate(
        async ({ scope, revision }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 100);

            try {
                await fetch(`/api/v1/watch?scopes=${encodeURIComponent(scope)}&revision=${revision}&timeout=60`, {
                    signal: controller.signal,
                });

                return 'unexpected response';
            } catch (error) {
                return error instanceof Error ? error.name : 'unknown';
            } finally {
                clearTimeout(timer);
            }
        },
        { scope, revision },
    );

    expect(result).toBe('AbortError');

    const reconnected = await page.request.get(`/api/v1/watch?scopes=${encodeURIComponent(scope)}&revision=${revision}&timeout=1`);

    expect(reconnected.status()).toBe(200);
    expect((await reconnected.json()).changes).toEqual([]);
});

/** Browser paths must survive reloads and use client navigation for Kumo sidebar links. */
test('supports deep links, reload, browser history, and unknown pages', async ({ page }, testInfo) => {
    await signIn(page);

    const { slug } = await seedProject(page);
    const projectPath = `/projects/${slug}/environments/prod`;

    await page.goto(projectPath);
    await expect(page.getByRole('heading', { name: 'prod', exact: true })).toBeVisible();
    // An expired session must return to this exact resource after signing in again.
    await page.context().clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(projectPath + '$'));
    await expect(page.getByRole('heading', { name: 'prod', exact: true })).toBeVisible();

    if (testInfo.project.name === 'desktop') {
        await page.getByRole('button', { name: 'Toggle navigation' }).click();
        await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toHaveAttribute('data-state', 'collapsed');

        const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });

        await page.getByRole('heading', { name: 'prod', exact: true }).hover();
        await expect(page.getByTestId('brand-title')).toBeHidden();
        await page.screenshot({
            path: testInfo.outputPath('sidebar-collapsed.png'),
            fullPage: true,
            animations: 'disabled',
        });

        const titlebarBefore = await page.getByRole('banner', { name: 'Titlebar' }).boundingBox();
        const before = await page.getByRole('main').boundingBox();

        await navigation.getByRole('link', { name: 'API Tokens', exact: true }).hover();
        await expect(navigation).toHaveAttribute('data-state', 'peeking');
        expect(await page.getByRole('main').boundingBox()).toEqual(before);
        expect(await page.getByRole('banner', { name: 'Titlebar' }).boundingBox()).toEqual(titlebarBefore);
        await expect(page.getByTestId('brand-title')).toBeVisible();
        await page.getByRole('heading', { name: 'prod', exact: true }).hover();
        await expect(navigation).toHaveAttribute('data-state', 'collapsed');
        await page.getByRole('button', { name: 'Toggle navigation' }).click();
        await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toHaveAttribute('data-state', 'expanded');
    }

    await page.reload();
    await expect(page.getByRole('heading', { name: 'prod', exact: true })).toBeVisible();
    await page.evaluate(() => {
        document.documentElement.dataset.navigationMarker = 'preserved';
    });

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    await page
        .getByRole('navigation', { name: 'Main navigation', exact: true })
        .getByRole('link', { name: 'API Tokens', exact: true })
        .click();
    await expect(page).toHaveURL(/\/api-keys$/);
    await expect(page.getByRole('heading', { name: 'API Tokens', exact: true })).toBeVisible();
    expect(await page.locator('html').getAttribute('data-navigation-marker')).toBe('preserved');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(projectPath + '$'));
    await expect(page.getByRole('heading', { name: 'prod', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'API Tokens', exact: true })).toBeVisible();
    await page.goto('/unknown-page');
    await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();

    const unknownApi = await page.request.get('/api/v1/unknown');

    expect(unknownApi.status()).toBe(404);
    expect(unknownApi.headers()['content-type']).toContain('application/json');
});

/** Slow responses must not unmount existing rows or replace them with a loading screen. */
test('retains configuration during refresh, search, and request failures', async ({ page }) => {
    await signIn(page);

    const { slug } = await seedProject(page);
    const base = `/api/v1/projects/${slug}/environments/prod`;

    for (const key of ['feature.enabled', 'server.port']) {
        const response = await page.request.put(`${base}/configurations/${key}`, {
            headers: { Origin: 'http://127.0.0.1:4174', 'If-None-Match': '*' },
            data: { value: 'YES', type: 'text' },
        });

        expect(response.ok()).toBe(true);
    }

    const watching = page.waitForRequest((request) => {
        const url = new URL(request.url());

        return url.pathname === '/api/v1/watch' && url.searchParams.get('scopes') === `${slug}/prod` && url.searchParams.has('revision');
    });

    await page.goto(`/projects/${slug}/environments/prod`);
    await watching;

    const region = page.getByRole('region', { name: 'Configuration', exact: true });

    await expect(region).toHaveAttribute('aria-busy', 'false');

    const table = region.getByRole('table');

    await expect(table.getByRole('row')).toHaveCount(3);
    await table.evaluate((node) => {
        node.dataset.identity = 'retained';
    });

    const bounds = await table.boundingBox();
    let release!: () => void;
    let pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    let fail = false;
    let configReads = 0;

    await page.route(`**${base}/configurations`, async (route) => {
        configReads++;
        await pending;

        if (fail) {
            await route.fulfill({
                status: 503,
                json: { code: 'unavailable', message: 'Temporarily unavailable.' },
            });
        } else {
            await route.fulfill({ response: await route.fetch() });
        }
    });
    await page.getByRole('button', { name: 'Refresh configuration' }).click();
    await expect(region.getByRole('status', { name: 'Updating configuration…' })).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table).toHaveAttribute('data-identity', 'retained');
    expect(await table.boundingBox()).toEqual(bounds);
    await expect(region.getByRole('status', { name: 'Loading configuration…', exact: true })).toHaveCount(0);
    release();
    await expect(region).toHaveAttribute('aria-busy', 'false');
    pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.getByRole('textbox', { name: 'Search configuration keys', exact: true }).fill('feature');
    await expect(region.getByRole('status', { name: 'Updating configuration…' })).toHaveCount(0);
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toHaveAttribute('data-identity', 'retained');
    expect(configReads).toBe(1);
    release();
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'feature.enabled', exact: true })).toBeVisible();
    fail = true;
    await page.getByRole('button', { name: 'Refresh configuration' }).click();
    await expect(page.getByRole('alert')).toContainText('Temporarily unavailable.');
    await expect(table).toHaveAttribute('data-identity', 'retained');
    await expect(table.getByRole('row')).toHaveCount(2);
    fail = false;
    await page.getByRole('button', { name: 'Refresh configuration' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(region).toHaveAttribute('aria-busy', 'false');
    pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`**${base}/history`, async (route) => {
        await pending;
        await route.fulfill({ response: await route.fetch() });
    });
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Loading history…', exact: true })).toBeVisible();
    await expect(page.getByText('No history yet', { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByRole('region', { name: 'Configuration history', exact: true })).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('cell', { name: 'feature.enabled', exact: true })).toBeVisible();
});

/** Full collections remain mounted during refresh failures and can be retried. */
test('loads all API tokens without pagination and retains them during refresh failures', async ({ page }) => {
    await signIn(page);

    const keys = Array.from({ length: 205 }, (_, index) => ({
        id: `key-${index}`,
        name: `Application ${index}`,
        prefix: `lc_${index}`,
        scopes: [],
        created_at: '2026-01-01T00:00:00Z',
        last_used_at: null,
        expires_at: null,
    }));

    let release!: () => void;

    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });

    let requests = 0;
    let fail = true;

    await page.route('**/api/v1/api-keys', async (route) => {
        expect(new URL(route.request().url()).search).toBe('');

        if (++requests > 1) {
            await pending;

            if (fail) {
                await route.fulfill({
                    status: 503,
                    json: { code: 'unavailable', message: 'Temporarily unavailable.' },
                });

                return;
            }
        }

        await route.fulfill({ json: { items: keys, total: keys.length } });
    });
    await page.goto('/api-keys');

    const region = page.getByRole('region', { name: 'API Tokens', exact: true });
    const table = region.getByRole('table');

    await expect(table.getByRole('row')).toHaveCount(206);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toHaveCount(0);
    await table.evaluate((node) => {
        node.dataset.identity = 'retained';
    });
    await region.getByRole('button', { name: 'Refresh API tokens', exact: true }).click();
    await expect(region).toHaveAttribute('aria-busy', 'true');
    await expect(table).toHaveAttribute('data-identity', 'retained');
    await expect(table.getByRole('row')).toHaveCount(206);
    release();
    await expect(page.getByRole('alert')).toContainText('Temporarily unavailable.');
    await expect(table).toHaveAttribute('data-identity', 'retained');
    fail = false;
    await region.getByRole('button', { name: 'Refresh API tokens', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(table.getByRole('row')).toHaveCount(206);
    await region.getByRole('textbox', { name: 'Search API tokens' }).fill('Application 204');
    await expect(table.getByRole('row')).toHaveCount(2);
});

/** Environment routes use the global titlebar, while only the selected sidebar level is active. */
test('navigates collapsible projects and switches environments in the titlebar', async ({ page }, testInfo) => {
    await signIn(page);

    const { slug, project } = await seedProject(page);

    project.name = `支付服务 Payments ${slug}`;

    const renamedProject = await page.request.patch(`/api/v1/projects/${slug}`, {
        headers: { Origin: 'http://127.0.0.1:4174' },
        data: { name: project.name },
    });

    expect(renamedProject.status()).toBe(200);

    const staging = await page.request.post(`/api/v1/projects/${slug}/environments`, {
        headers: { Origin: 'http://127.0.0.1:4174' },
        data: { slug: 'staging', description: 'Staging' },
    });

    expect(staging.status()).toBe(201);

    const other = await seedProject(page);

    await page.request.patch(`/api/v1/projects/${other.slug}/environments/prod`, {
        headers: { Origin: 'http://127.0.0.1:4174' },
        data: { description: 'Other project environment' },
    });
    await page.goto(`/projects/${slug}`);
    await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Environments', exact: true }).getByRole('row')).toHaveCount(3);
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));

    const titlebar = page.getByRole('banner', { name: 'Titlebar', exact: true });

    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
    await expect(titlebar.getByRole('combobox', { name: 'Switch project' })).toContainText(project.name);

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const projectButton = navigation.getByRole('button', { name: project.name, exact: true });

    const projectItem = navigation.getByRole('listitem').filter({ has: page.getByRole('button', { name: project.name, exact: true }) });

    await expect(projectButton).toHaveAttribute('aria-expanded', 'true');

    const iconBox = await projectButton.locator('svg').first().boundingBox();
    const labelBox = await projectButton.getByText(project.name, { exact: true }).boundingBox();

    expect(iconBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(Math.abs(iconBox!.y + iconBox!.height / 2 - labelBox!.y - labelBox!.height / 2)).toBeLessThanOrEqual(0.5);
    await navigation.screenshot({
        path: testInfo.outputPath('sidebar-alignment.png'),
        animations: 'disabled',
    });
    await expect(navigation.getByRole('link', { name: 'Create project', exact: true })).toHaveCount(0);
    await expect(projectItem.getByRole('link', { name: 'prod', exact: true })).toBeVisible();
    await expect(projectItem.getByRole('link', { name: 'staging', exact: true })).toBeVisible();
    await expect(projectButton).not.toHaveAttribute('data-active', 'true');
    await expect(projectItem.getByRole('link', { name: 'Project overview', exact: true })).toHaveAttribute('data-active', 'true');
    await projectButton.click();
    await expect(projectButton).toHaveAttribute('aria-expanded', 'false');
    await expect(projectItem.getByRole('link', { name: 'Project overview', exact: true })).toBeHidden();
    await projectButton.click();
    await projectItem.getByRole('link', { name: 'Project overview', exact: true }).click();

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    await projectItem.getByRole('link', { name: 'prod', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'prod', exact: true })).toBeVisible();
    await expect(titlebar.getByRole('combobox', { name: 'Switch project' })).toHaveCount(0);
    await page.evaluate(() => {
        document.documentElement.dataset.environmentNavigation = 'preserved';
    });
    await titlebar.getByRole('combobox', { name: 'Switch environment', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Other project environment', exact: false })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'prod Production', exact: true })).toHaveAttribute('aria-selected', 'true');

    const search = page.getByRole('combobox', { name: 'Search environments', exact: true });

    await search.fill('staging');
    await expect(page.getByRole('option', { name: 'prod Production', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'staging Staging', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}/environments/staging$`));
    await expect(page.getByRole('heading', { name: 'staging', exact: true })).toBeVisible();
    expect(await page.locator('html').getAttribute('data-environment-navigation')).toBe('preserved');
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Switch environment', exact: true })).toContainText('staging');
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'prod', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'staging', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Switch environment', exact: true }).click();
    await search.fill('missing');
    await expect(page.getByText('No matching environments', { exact: true })).toBeVisible();

    const emptyAlignment = await page.getByText('No matching environments', { exact: true }).evaluate((element) => {
        const range = document.createRange();

        range.selectNodeContents(element);

        const text = range.getBoundingClientRect();
        const panel = element.parentElement!.getBoundingClientRect();

        return {
            horizontal: Math.abs(text.x + text.width / 2 - panel.x - panel.width / 2),
            vertical: Math.abs(text.y + text.height / 2 - panel.y - panel.height / 2),
        };
    });

    expect(emptyAlignment.horizontal).toBeLessThanOrEqual(1);
    expect(emptyAlignment.vertical).toBeLessThanOrEqual(2);
    await page.screenshot({
        path: testInfo.outputPath('empty-environment-switcher.png'),
        animations: 'disabled',
    });
    await search.fill('');

    const viewAll = page.getByRole('link', { name: 'View all environments', exact: true });

    if (testInfo.project.name === 'desktop') {
        const background = await viewAll.evaluate((element) => getComputedStyle(element).backgroundColor);

        await viewAll.hover();
        await expect(viewAll).not.toHaveCSS('background-color', background);
    }

    await page.screenshot({
        path: testInfo.outputPath('environment-switcher.png'),
        fullPage: true,
        animations: 'disabled',
    });
    await viewAll.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
    await expect(titlebar.getByRole('combobox', { name: 'Switch project' })).toContainText(project.name);
    await expect(titlebar.getByRole('combobox', { name: 'Switch environment' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Environments', exact: true }).getByRole('row')).toHaveCount(3);
    await page.screenshot({
        path: testInfo.outputPath('project-overview.png'),
        fullPage: true,
        animations: 'disabled',
    });
});

/** Project switching keeps overview routes and loads only the selected project's environments. */
test('switches projects from overview using the global titlebar', async ({ page }, testInfo) => {
    await signIn(page);

    const first = await seedProject(page);
    const second = await seedProject(page);

    const renamed = await page.request.patch(`/api/v1/projects/${second.slug}/environments/prod`, {
        headers: { Origin: 'http://127.0.0.1:4174' },
        data: { description: 'Preview' },
    });

    expect(renamed.status()).toBe(200);
    await page.goto(`/projects/${first.slug}`);

    const titlebar = page.getByRole('banner', { name: 'Titlebar', exact: true });
    const trigger = titlebar.getByRole('combobox', { name: 'Switch project', exact: true });

    await expect(trigger).toContainText(first.project.name);
    await expect(titlebar.getByRole('button', { name: 'User menu', exact: true })).toBeVisible();
    await page.evaluate(() => {
        document.documentElement.dataset.projectNavigation = 'preserved';
    });
    await trigger.click();
    await expect(page.getByRole('option', { name: `${first.project.name} ${first.slug}`, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
    );

    const search = page.getByRole('combobox', { name: 'Search projects', exact: true });

    await search.fill(second.slug);
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('option', { name: `${second.project.name} ${second.slug}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${second.slug}$`));
    await expect(page.getByRole('heading', { name: second.project.name, exact: true })).toBeVisible();

    const environments = page.getByRole('region', { name: 'Environments', exact: true });

    await expect(environments.getByText('Preview', { exact: true })).toBeVisible();
    await expect(environments.getByText('Production', { exact: true })).toHaveCount(0);
    await expect(trigger).toContainText(second.project.name);
    await expect(page.locator('html')).toHaveAttribute('data-project-navigation', 'preserved');
    await page.goBack();
    await expect(trigger).toContainText(first.project.name);
    await expect(environments.getByText('Production', { exact: true })).toBeVisible();
    await page.goForward();
    await expect(environments.getByText('Preview', { exact: true })).toBeVisible();
    await page.reload();
    await expect(trigger).toContainText(second.project.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await trigger.click();
    await search.fill('no-project-matches-this-query');
    await expect(page.getByText('No matching projects', { exact: true })).toBeVisible();
    await search.fill('');
    await page.screenshot({
        path: testInfo.outputPath('project-switcher.png'),
        fullPage: true,
        animations: 'disabled',
    });
    await page.getByRole('link', { name: 'View all projects', exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
});

/** Settings omit language controls while the account menu keeps the shared preference. */
test('keeps language preferences in the account menu and account settings on the page', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Account Settings', exact: true })).toBeVisible();
    await expect(page.getByLabel('Username', { exact: true })).toHaveValue('admin');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Language', exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('combobox', { name: 'Language', exact: true })).toHaveCount(0);
    await selectChinese(page);
    await expect(page.getByRole('heading', { name: '账户设置', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '账户设置', exact: true })).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('settings.png'),
        fullPage: true,
        animations: 'disabled',
    });
});

/** Deletion is validated by the API, and shared state keeps navigation synchronized afterward. */
test('hides empty project navigation and lets the API validate deletion', async ({ page }, testInfo) => {
    const slug = `deletion-${crypto.randomUUID().slice(0, 8)}`;

    // Isolate this view from projects belonging to other browser scenarios.
    await page.route('**/api/v1/projects', async (route) => {
        if (route.request().method() !== 'GET') {
            return route.continue();
        }

        const response = await route.fetch();
        const data = await response.json();
        const items = data.items.filter((project: { slug: string }) => project.slug === slug);

        await route.fulfill({ response, json: { items, total: items.length } });
    });
    await signIn(page);

    const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/projects');
    await expect(navigation.getByText('Projects', { exact: true })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'API Tokens', exact: true })).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('empty-project-navigation.png'),
        animations: 'disabled',
    });

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Close navigation' }).click();
    }

    await page.getByRole('button', { name: 'Create project', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('Name', { exact: true }).fill('Disposable project');
    await dialog.getByLabel('Slug', { exact: true }).fill(slug);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Disposable project', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit project', exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('Renamed project');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Switch project', exact: true })).toContainText('Renamed project');

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Renamed project', exact: true })).toBeVisible();

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Close navigation' }).click();
    }

    await page.getByRole('button', { name: 'Create environment', exact: true }).first().click();
    await dialog.getByLabel('Remarks (optional)', { exact: true }).fill('Production');
    await dialog.getByLabel('Identifier', { exact: true }).fill('prod');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Create configuration', exact: true }).first().click();
    await dialog.getByLabel('Configuration key', { exact: true }).fill('feature.enabled');
    await dialog.getByLabel('Value', { exact: true }).fill('YES');
    await dialog.getByRole('button', { name: 'Save configuration' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete environment', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();

    const rejectedEnvironmentDeletion = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/api/v1/projects/${slug}/environments/prod` && response.request().method() === 'DELETE',
    );

    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect((await rejectedEnvironmentDeletion).status()).toBe(409);
    await expect(dialog.getByRole('alert')).toHaveText('Delete all configuration before deleting this environment.');
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.screenshot({
        path: testInfo.outputPath('environment-deletion-error.png'),
        animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    // Reopening must not show an error from a previously rejected request.
    await page.getByRole('button', { name: 'Delete environment', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('combobox', { name: 'Switch environment', exact: true }).click();
    await page.getByRole('link', { name: 'View all environments', exact: true }).click();
    await page.getByRole('button', { name: 'Delete project', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();

    const rejectedProjectDeletion = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/v1/projects/${slug}` && response.request().method() === 'DELETE',
    );

    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect((await rejectedProjectDeletion).status()).toBe(409);
    await expect(dialog.getByRole('alert')).toHaveText('Delete all environments before deleting this project.');
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('region', { name: 'Environments', exact: true }).getByRole('link', { name: 'prod', exact: true }).click();
    await page.getByRole('button', { name: 'Delete feature.enabled', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'feature.enabled', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete environment', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
    await expect(page.getByRole('heading', { name: 'Create your first environment', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete project', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { name: 'Create your first project', exact: true })).toBeVisible();

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Renamed project', exact: true })).toHaveCount(0);
});

/** Reauthentication in the same SPA must not reuse metadata from the prior session. */
test('clears shared project and environment state when signing out', async ({ page }, testInfo) => {
    await signIn(page);

    const { slug, project } = await seedProject(page);

    await page.goto(`/projects/${slug}/environments/prod`);
    await expect(page.getByRole('heading', { name: 'prod', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'User menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await page.route('**/api/v1/projects', (route) => route.fulfill({ json: { items: [], total: 0 } }));
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // The previous deep link now resolves against the new session's project list.
    await expect(page.getByRole('heading', { name: 'Project not found', exact: true })).toBeVisible();

    if (testInfo.project.name === 'mobile') {
        await page.getByRole('button', { name: 'Open navigation' }).click();
    }

    const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });

    await expect(navigation.getByRole('button', { name: project.name, exact: true })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'prod', exact: true })).toHaveCount(0);
});
