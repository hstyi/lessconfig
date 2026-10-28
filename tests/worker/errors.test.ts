import { expect, test, vi } from 'vitest';
import { exports } from 'cloudflare:workers';
import { ApiError, body, configInput, errorResponse } from '../../worker/common';

/** Every expected failure exposes exactly a stable code and an English message. */
test.each([
    [400, 'invalid_slug'],
    [401, 'authentication_required'],
    [403, 'administrator_required'],
    [404, 'project_not_found'],
    [405, 'method_not_allowed'],
    [409, 'project_not_empty'],
    [409, 'environment_not_empty'],
    [409, 'config_revision_conflict'],
    [413, 'payload_too_large'],
    [415, 'unsupported_media_type'],
    [428, 'precondition_required'],
    [429, 'too_many_requests'],
    [503, 'service_unavailable'],
] as const)('serializes HTTP %i as %s', async (status, code) => {
    const response = errorResponse(new ApiError(status, code, 'An English message.'));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code: code, message: 'An English message.' });
});

test('keeps internal exception details out of error responses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
        const response = errorResponse(new Error('Private SQL details'));

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            code: 'internal_error',
            message: 'The service is temporarily unavailable. Try again later.',
        });
    } finally {
        log.mockRestore();
    }
});

test('does not localize API errors for Chinese-speaking clients', async () => {
    const response = await exports.default.fetch('https://lessconfig.test/api/v1/projects', {
        headers: { 'Accept-Language': 'zh-CN' },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
        code: 'authentication_required',
        message: 'Sign in or provide a valid API token.',
    });
});

test('uses the same error contract outside the API version prefix', async () => {
    const response = await exports.default.fetch('https://lessconfig.test/api/unknown');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
        code: 'endpoint_not_found',
        message: 'The endpoint does not exist.',
    });
});

test('rejects malformed JSON with an English validation message', async () => {
    await expect(
        body(
            new Request('https://lessconfig.test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{',
            }),
        ),
    ).rejects.toThrow('Invalid JSON.');
});

test('keeps user-provided configuration text unchanged', () => {
    const value = '# 保留用户注释\nfeature: YES\n';

    expect(configInput({ type: 'yaml', value }).value).toBe(value);
});
