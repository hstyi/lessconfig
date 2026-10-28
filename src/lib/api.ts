import i18n from './i18n.ts';
import type { PhosphorIcon } from '@phosphor-icons/core';

/** The content syntax accepted by the configuration API. */
export type ConfigType = 'text' | 'boolean' | 'number' | 'json' | 'yaml' | 'properties';

/** Project metadata returned to an authorized client. */
export type Project = {
    id: string;
    slug: string;
    name: string;
    icon: PhosphorIcon['name'];
    description: string;
};

/** An environment and the global revision of its latest configuration change. */
export type Environment = {
    id: string;
    project_id: string;
    slug: string;
    description: string;
    revision: number;
};

/** Full configuration content returned by environment lists and individual reads. */
export type Config = {
    key: string;
    value: string;
    type: ConfigType;
    description: string;
    revision: number;
    created_at: string;
    updated_at: string;
    bytes?: number;
};

/** An immutable version captured by a configuration mutation. */
export type History = Config & { id: string; action: string; actor: string; created_at: string };

/** A historical change and the preceding event for the same configuration key. */
export type HistoryDetail = History & { previous: History | null };

/** A grant covering current and future resources when either identifier is the wildcard '*'. */
export type Scope = {
    project_id: string;
    environment_id: string;
    permission: 'read' | 'write';
    project_name?: string | null;
    environment_slug?: string | null;
};

/** Displayable API token metadata. Plaintext secrets never appear in key listings. */
export type ApiKey = {
    id: string;
    name: string;
    prefix: string;
    /** Inclusive UTC expiration date in YYYY-MM-DD format, or null for no expiration. */
    expires_at: string | null;
    last_used_at: string | null;
    created_at: string;
    scopes: Scope[];
};

/** Account identity returned by the session endpoint. */
export type User = { username: string; kind: 'user'; role: 'admin' | 'user'; defaultPassword: boolean };

/** A complete resource list; watch responses provide global synchronization progress separately. */
export type ListResponse<T> = {
    items: T[];
    total: number;
};

/** An initial watch position or a long-poll watermark with compact invalidations. */
export type WatchResult = {
    revision: number;
    changes: {
        revision: number;
        project: string;
        environment: string | null;
        key: string | null;
        resource: 'project' | 'environment' | 'config';
        type: 'created' | 'updated' | 'deleted' | 'restored';
    }[];
};

/** An API failure with its HTTP status, stable business code, and English server message. */
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
 * Call the versioned API using the HttpOnly session cookie.
 * @typeParam T - The successful response payload, defaulting to void for empty responses.
 * @param path - The resource path relative to /api/v1.
 * @param options - Fetch options merged with the session and JSON request defaults.
 * @returns The parsed JSON payload, or undefined when the successful response is empty.
 * @throws ApiError - When the server returns an unsuccessful status.
 */
export async function api<T = void>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);

    if (options.body) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch('/api/v1' + path, {
        ...options,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
    });

    const content = await response.text();
    const result = content ? JSON.parse(content) : undefined;

    if (!response.ok) {
        if (response.status === 401 && !['/auth/login', '/auth/me'].includes(path)) {
            window.dispatchEvent(new Event('session-expired'));
        }

        throw new ApiError(response.status, result?.code ?? 'request_failed', result?.message ?? 'Request failed.');
    }

    return result as T;
}

/** Fetch every matching resource record in one request. */
export async function listItems<T>(path: string): Promise<T[]> {
    return (await api<ListResponse<T>>(path)).items;
}

/** Build the canonical resource path from immutable project and environment slugs. */
export function environmentPath(project: Project, environment: Environment) {
    return `/projects/${project.slug}/environments/${environment.slug}`;
}

/** Use creation or revision preconditions to prevent accidental overwrites. */
export function revisionHeaders(revision?: number): HeadersInit {
    return revision === undefined ? { 'If-None-Match': '*' } : { 'If-Match': `"${revision}"` };
}

/** Normalize unknown failures for display without assuming every rejection is an Error. */
export function message(error: unknown) {
    return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

/** Format API timestamps in the selected language and the browser local time zone. */
export function date(value?: string | null) {
    return value
        ? new Date(value).toLocaleString(i18n.language, {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
          })
        : '—';
}

/** Standard format names shared by the editor and configuration list. */
export const typeLabels: Record<ConfigType, string> = {
    text: 'Text',
    boolean: 'Boolean',
    number: 'Number',
    json: 'JSON',
    yaml: 'YAML',
    properties: 'Properties',
};
