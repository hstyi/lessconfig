import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('signs in with a stale cookie, restores the KV session, and clears it on logout', async ({ context, page }, testInfo) => {
    const client = createHash('sha256').update(testInfo.testId).digest();
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.19.${client[0]}.${client[1]}` });
    await context.addCookies([{ name: 'lessconfig_session', value: 'lcs_old-session', domain: '127.0.0.1', path: '/api', httpOnly: true }]);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    const session = (await context.cookies()).find((cookie) => cookie.name === 'lessconfig_session')!;
    expect(session.value).toMatch(/^lcs_[a-f0-9]{64}$/);
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe('Strict');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'User menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    expect((await context.cookies()).some((cookie) => cookie.name === 'lessconfig_session')).toBe(false);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
});
