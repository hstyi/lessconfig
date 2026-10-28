import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:4174';

test('exports and imports a workspace with existing, new, empty, and failed records', async ({ page, context }, testInfo) => {
    const client = createHash('sha256').update(testInfo.testId).digest();
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.20.${client[0]}.${client[1]}` });
    await page.goto('/');
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    const slug = `Transfer.Test_${crypto.randomUUID().slice(0, 8)}`;
    const newSlug = `${slug}-new`;
    const emptySlug = `${slug}-empty`;
    const headers = { Origin: origin };
    const project = await page.request.post('/api/v1/projects', { headers, data: { slug, name: 'Original', description: 'Before' } });
    expect(project.status()).toBe(201);
    expect((await page.request.post('/api/v1/projects', { headers, data: { slug: emptySlug, name: 'Empty project' } })).status()).toBe(201);
    const base = `/api/v1/projects/${slug}`;
    expect(
        (await page.request.post(`${base}/environments`, { headers, data: { slug: 'prod', description: 'Old environment' } })).status(),
    ).toBe(201);
    expect((await page.request.post(`${base}/environments`, { headers, data: { slug: 'empty-source' } })).status()).toBe(201);
    const configs = `${base}/environments/prod/configurations`;
    for (const key of ['existing', 'keep']) {
        expect(
            (
                await page.request.put(`${configs}/${key}`, {
                    headers: { ...headers, 'If-None-Match': '*' },
                    data: { type: 'text', value: 'before', description: '' },
                })
            ).status(),
        ).toBe(201);
    }

    await page.goto('/import-export');
    const exportSection = page.getByRole('region', { name: 'Export workspace' });
    const downloadPromise = page.waitForEvent('download');
    await exportSection.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('lessconfig-export.json');
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(exported.version).toBe(1);
    const entry = exported.projects.find((item: { slug: string }) => item.slug === slug);
    expect(entry).toEqual({
        slug,
        name: 'Original',
        icon: 'folder-simple',
        description: 'Before',
        environments: [
            {
                slug: 'prod',
                description: 'Old environment',
                configs: [
                    { key: 'existing', type: 'text', value: 'before', description: '' },
                    { key: 'keep', type: 'text', value: 'before', description: '' },
                ],
            },
            { slug: 'empty-source', description: '', configs: [] },
        ],
    });
    expect(exported.projects.find((item: { slug: string }) => item.slug === emptySlug).environments).toEqual([]);
    expect(JSON.stringify(exported)).not.toContain('password_hash');

    const input = page.getByLabel('JSON file');
    const importSection = page.getByRole('region', { name: 'Import workspace' });
    const bundle = {
        version: 1,
        projects: [
            {
                slug,
                name: 'Renamed',
                icon: 'folder-simple',
                description: 'After',
                environments: [
                    {
                        slug: 'prod',
                        description: 'New environment',
                        configs: [
                            { key: 'existing', type: 'text', value: 'after', description: 'Changed' },
                            { key: 'added', type: 'json', value: '{"ok":true}', description: '' },
                            { key: 'invalid', type: 'boolean', value: 'invalid', description: '' },
                        ],
                    },
                    { slug: 'empty', description: '', configs: [] },
                ],
            },
            { slug: newSlug, name: 'New project', icon: 'folder-simple', description: '', environments: [] },
        ],
    };
    await input.setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
    await expect(importSection.getByText('Ready: 2 projects, 2 environments, 3 configuration entries.')).toBeVisible();
    const conditions = new Map<string, string | undefined>();
    page.on('request', (request) => {
        if (request.method() === 'PUT' && request.url().includes(`${configs}/`)) {
            conditions.set(
                new URL(request.url()).pathname.split('/').at(-1)!,
                request.headers()['if-match'] ?? request.headers()['if-none-match'],
            );
        }
    });
    await importSection.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(importSection.getByRole('status').filter({ hasText: 'Processed' })).toContainText(
        'Processed 2 projects, 2 environments, 2 configuration entries.',
    );
    await expect(importSection.getByText(`${slug}/prod/invalid`, { exact: false })).toBeVisible();
    expect(conditions.get('existing')).toMatch(/^"\d+"$/);
    expect(conditions.get('added')).toBe('*');
    expect(await (await page.request.get(base)).json()).toMatchObject({ name: 'Renamed', description: 'After' });
    expect(await (await page.request.get(`${base}/environments/prod`)).json()).toMatchObject({ description: 'New environment' });
    expect(await (await page.request.get(`${configs}/existing`)).json()).toMatchObject({ value: 'after', description: 'Changed' });
    expect((await page.request.get(`${configs}/keep`)).status()).toBe(200);
    expect((await page.request.get(`${configs}/added`)).status()).toBe(200);
    expect((await page.request.get(`${configs}/invalid`)).status()).toBe(404);
    expect((await page.request.get(`${base}/environments/empty`)).status()).toBe(200);
    expect((await page.request.get(`/api/v1/projects/${newSlug}`)).status()).toBe(200);

    const successful = structuredClone(bundle);
    successful.projects[0].environments[0].configs.pop();
    await input.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(successful)) });
    await importSection.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('Workspace import complete.', { exact: true })).toBeVisible();
    await expect(importSection.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

    const duplicate = { version: 1, projects: [bundle.projects[0], bundle.projects[0]] };
    await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(duplicate)) });
    await expect(importSection.getByRole('alert')).toHaveText(
        'The file contains duplicate project, environment, or configuration identifiers.',
    );
    await expect(importSection.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('workspace-transfer.png'), animations: 'disabled' });
    await page.route('**/api/v1/projects', (route) => route.fulfill({ json: { items: [], total: 0 } }));
    const emptyDownload = page.waitForEvent('download');
    await exportSection.getByRole('button', { name: 'Export', exact: true }).click();
    expect(JSON.parse(await readFile((await (await emptyDownload).path())!, 'utf8'))).toEqual({ version: 1, projects: [] });
});
