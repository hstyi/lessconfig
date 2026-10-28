import { parseDocument } from 'yaml';
import { isPlainObject, isString } from 'lodash-es';
import type { PhosphorIcon } from '@phosphor-icons/core';
import { IDENTIFIER_MESSAGE, isIdentifier } from '../shared/identifiers';

/** Supported content types; values are stored as raw UTF-8 strings. */
export const CONFIG_TYPES = ['text', 'boolean', 'number', 'json', 'yaml', 'properties'] as const;

/** Content syntax used for validation and raw download headers. */
export type ConfigType = (typeof CONFIG_TYPES)[number];

/** Validated, user-authored configuration content. */
export type ConfigInput = { value: string; type: ConfigType; description: string };

/** A configuration value with its environment and optimistic concurrency revision. */
export type Config = ConfigInput & {
    environment_id: string;
    key: string;
    revision: number;
    created_at: string;
    updated_at: string;
};

/** An isolated namespace recording the global revision of its latest configuration mutation. */
export type Environment = {
    id: string;
    project_id: string;
    slug: string;
    description: string;
    revision: number;
};

/** A named collection of environments addressed by an immutable slug. */
export type Project = {
    id: string;
    slug: string;
    name: string;
    icon: PhosphorIcon['name'];
    description: string;
};

/** A grant covering current and future resources when either identifier is the wildcard '*'. */
export type Scope = {
    project_id: string;
    environment_id: string;
    permission: 'read' | 'write';
};

export type UserRole = 'admin' | 'user';

/** An authenticated account or API token and its explicit resource grants. */
export type Principal = { id: string; name: string; scopes: Scope[] } & (
    | { kind: 'user'; userId: number; role: UserRole }
    | { kind: 'key' }
);

/** An expected API failure whose English message is safe to return to clients. */
export class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/**
 * Throw a client-safe failure handled by the outer HTTP boundary.
 * @param status - The HTTP status of the failure.
 * @param code - The stable machine-readable reason for this failure.
 * @param message - The English message safe to return to the client.
 * @throws ApiError - Always, with the supplied status and English message.
 */
export function fail(status: number, code: string, message: string): never {
    throw new ApiError(status, code, message);
}

/** Create a JSON response that must not be cached by clients or intermediaries. */
export function json(data: unknown, status = 200, headers?: HeadersInit) {
    const response = Response.json(data, { status, headers });

    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');

    return response;
}

/**
 * Create an empty response while retaining the endpoint's HTTP status and headers.
 * @param status - The HTTP status returned by the endpoint.
 * @param headers - Additional headers, such as a session cookie to clear.
 * @returns A non-cacheable response without a body or JSON content type.
 */
export function emptyResponse(status = 200, headers?: HeadersInit): Response {
    const response = new Response(null, { status, headers });

    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');

    return response;
}

/** Serialize expected errors and redact internal failures using the public error contract. */
export function errorResponse(error: unknown) {
    if (error instanceof ApiError) {
        return json({ code: error.code, message: error.message }, error.status);
    }

    console.error(
        JSON.stringify({
            event: 'request_error',
            message: error instanceof Error ? error.message : 'Unknown error',
        }),
    );

    return json(
        {
            code: 'internal_error',
            message: 'The service is temporarily unavailable. Try again later.',
        },
        500,
    );
}

/**
 * Read a JSON object without imposing an application-level body size limit.
 * @param request - The incoming request containing an application/json body.
 * @throws ApiError - If the body is missing or its content type or JSON shape is invalid.
 */
export async function body(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
        fail(415, 'unsupported_media_type', 'Use the application/json content type.');
    }

    if (!request.body) {
        fail(400, 'body_required', 'The request body is required.');
    }

    try {
        const value: unknown = await request.json();

        if (!isPlainObject(value)) {
            fail(400, 'invalid_body', 'The request body must be a JSON object.');
        }

        return value as Record<string, unknown>;
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }

        fail(400, 'invalid_json', 'Invalid JSON.');
    }
}

/**
 * Validate a string field without altering its user-provided content.
 * @param value - The untrusted field value to validate.
 * @param label - The field name used in validation errors.
 * @param max - The maximum allowed length in UTF-16 code units, or null for no application limit.
 * @param empty - Whether empty and whitespace-only values are allowed.
 * @returns The original string after validation.
 */
export function text(value: unknown, label: string, max: number | null = 120, empty = false): string {
    if (!isString(value) || (!empty && !value.trim()) || (max !== null && value.length > max)) {
        const lengthMessage = max === null ? '' : `, with at most ${max} characters`;
        fail(400, 'invalid_field', `${label} must be a string${empty ? '' : ' and must not be empty'}${lengthMessage}.`);
    }

    return value;
}

/** Validate an immutable project or environment identifier for use in API paths. */
export function slug(value: unknown) {
    if (!isIdentifier(value)) {
        fail(400, 'invalid_slug', IDENTIFIER_MESSAGE);
    }

    return value;
}

/** Validate a single path-safe configuration key, including file-style names. */
export function configKey(value: string) {
    if (!isIdentifier(value)) {
        fail(400, 'invalid_config_key', IDENTIFIER_MESSAGE);
    }

    return value;
}

/** Validate configuration syntax while preserving original formatting and comments. */
export function configInput(data: Record<string, unknown>): ConfigInput {
    const value = text(data.value, 'Value', null, true);

    if (!CONFIG_TYPES.includes(data.type as ConfigType)) {
        fail(400, 'invalid_config_type', 'Unsupported configuration type.');
    }

    const type = data.type as ConfigType;
    const description = text(data.description ?? '', 'Description', 500, true);

    if (type === 'boolean' && value !== 'true' && value !== 'false') {
        fail(400, 'invalid_boolean', 'Boolean values must be true or false.');
    }

    if (type === 'number' && (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) {
        fail(400, 'invalid_number', 'Provide a valid finite number.');
    }

    if (type === 'json') {
        try {
            JSON.parse(value);
        } catch {
            fail(400, 'invalid_json', 'Invalid JSON.');
        }
    }

    if (type === 'yaml') {
        try {
            if (parseDocument(value, { uniqueKeys: true }).errors.length) {
                fail(400, 'invalid_yaml', 'Invalid YAML. Check indentation and duplicate keys.');
            }
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }

            fail(400, 'invalid_yaml', 'Invalid YAML.');
        }
    }

    return { value, type, description };
}

/**
 * Read the optimistic concurrency precondition for a configuration mutation.
 * @param request - The request containing an If-Match or If-None-Match header.
 * @returns Null for creation, or the expected current revision for an update.
 * @throws ApiError - If a valid precondition is missing.
 */
export function condition(request: Request): number | null {
    if (request.headers.get('if-none-match') === '*') {
        return null;
    }

    const match = request.headers.get('if-match')?.match(/^"?(\d+)"?$/);

    if (!match) {
        fail(428, 'precondition_required', 'Send If-None-Match: * to create, or If-Match with the current revision to update or delete.');
    }

    const version = Number(match[1]);

    if (!Number.isSafeInteger(version)) {
        fail(400, 'invalid_revision', 'Invalid revision.');
    }

    return version;
}

/** Identify administrators using the role attached to a user session. */
export function isAdmin(principal: Principal): principal is Extract<Principal, { kind: 'user' }> & { role: 'admin' } {
    return principal.kind === 'user' && principal.role === 'admin';
}

/** Evaluate project and environment grants; Edit includes Read access. */
export function permitted(principal: Principal, environment: Environment, write = false) {
    return (
        isAdmin(principal) ||
        (principal.kind === 'key' &&
            principal.scopes.some(
                (s) =>
                    (s.project_id === '*' || s.project_id === environment.project_id) &&
                    (s.environment_id === '*' || s.environment_id === environment.id) &&
                    (!write || s.permission === 'write'),
            ))
    );
}

/** Restrict resource administration endpoints to administrator sessions. */
export function requireAdmin(principal: Principal): asserts principal is Extract<Principal, { kind: 'user' }> & { role: 'admin' } {
    if (!isAdmin(principal)) {
        fail(403, 'administrator_required', 'This operation requires an administrator session.');
    }
}
