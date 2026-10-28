import { expect, test } from '@playwright/test';

for (const { browserLocale, expectedLocale, heading } of [
    { browserLocale: 'en-GB', expectedLocale: 'en', heading: 'Sign in' },
    { browserLocale: 'zh-CN', expectedLocale: 'zh-CN', heading: '登录' },
    { browserLocale: 'zh-TW', expectedLocale: 'zh-CN', heading: '登录' },
    { browserLocale: 'de-DE', expectedLocale: 'en', heading: 'Sign in' },
]) {
    test.describe(`browser language ${browserLocale}`, () => {
        test.use({ locale: browserLocale });

        test('selects a supported language without saving an explicit preference', async ({ page }) => {
            await page.goto('/login');
            await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
            await expect(page.locator('html')).toHaveAttribute('lang', expectedLocale);
            expect(await page.evaluate(() => navigator.language)).toBe(browserLocale);
            expect(await page.evaluate(() => localStorage.getItem('lessconfig.locale'))).toBeNull();
        });
    });
}

for (const { languages, expectedLocale, heading } of [
    { languages: ['fr-FR', 'zh-Hans-CN', 'en-US'], expectedLocale: 'zh-CN', heading: '登录' },
    { languages: ['fr-FR', 'en-US', 'zh-CN'], expectedLocale: 'en', heading: 'Sign in' },
]) {
    test(`honors browser preference order: ${languages.join(', ')}`, async ({ page }) => {
        await page.addInitScript((preferences) => {
            Object.defineProperty(navigator, 'languages', { get: () => preferences });
            // Invalid saved values must not suppress browser language detection.
            localStorage.setItem('lessconfig.locale', 'unsupported');
        }, languages);
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', expectedLocale);
    });
}

test.describe('Chinese browser preferences', () => {
    test.use({ locale: 'zh-CN' });

    test('keeps a manual English choice after reloading a Chinese browser', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '语言', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('lessconfig.locale'))).toBe('en');

        await page.reload();
        await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        expect(await page.evaluate(() => navigator.language)).toBe('zh-CN');
    });

    test('detects browser language and allows switching when local storage is blocked', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
                get() {
                    throw new DOMException('Storage access is disabled.', 'SecurityError');
                },
            });
        });
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
        await page.getByRole('button', { name: '语言', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });
});
