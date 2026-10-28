import { expect, test, type Locator } from '@playwright/test';
import { createHash } from 'node:crypto';

test('validates project and environment identifiers in the browser', async ({ page, context }, testInfo) => {
    const client = createHash('sha256').update(testInfo.testId).digest();
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.21.${client[0]}.${client[1]}` });
    await page.goto('/');
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click();
    const dialog = page.getByRole('dialog');

    async function validate(input: Locator) {
        for (const value of ['prod-1', 'a', 'a--b', '-Prod', 'Prod', 'Prod_test', '.Prod.test', '_Prod', 'A'.repeat(201)]) {
            await input.fill(value);
            expect(await input.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(true);
        }
        for (const value of ['prod test', 'prod/next', 'prod*', '环境', '.', '..']) {
            await input.fill(value);
            expect(await input.evaluate((element: HTMLInputElement) => element.validity.patternMismatch)).toBe(true);
        }
    }

    await validate(dialog.getByLabel('Slug', { exact: true }));
    const slug = `slug-${crypto.randomUUID().slice(0, 8)}`;
    await dialog.getByLabel('Name', { exact: true }).fill('Identifier validation');
    await dialog.getByLabel('Slug', { exact: true }).fill(slug);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Identifier validation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create environment', exact: true }).first().click();
    await validate(dialog.getByLabel('Identifier', { exact: true }));
});
