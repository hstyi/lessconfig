import { isPlainObject, uniq } from 'lodash-es';
import { body, fail, json, text, type Scope } from './common';
import { digest, randomToken } from './auth';

/** List key metadata and scopes without exposing plaintext tokens or stored digests. */
export async function listKeys(env: Env) {
    const results = await env.DB.batch<Record<string, unknown>>([
        env.DB.prepare('SELECT id, name, prefix, expires_at, last_used_at, created_at FROM api_keys ORDER BY created_at DESC, id'),
        env.DB.prepare(`SELECT s.api_key_id, COALESCE(s.project_id, '*') AS project_id,
      COALESCE(s.environment_id, '*') AS environment_id, s.permission,
      p.name AS project_name, p.slug AS project_slug, e.slug AS environment_slug
      FROM api_key_scopes s LEFT JOIN projects p ON p.id = s.project_id
      LEFT JOIN environments e ON e.id = s.environment_id ORDER BY s.id`),
    ]);

    const scopes = new Map<string, Record<string, unknown>[]>();

    for (const row of results[1].results) {
        const { api_key_id, ...scope } = row;
        const keyId = String(api_key_id);
        const group = scopes.get(keyId) ?? [];

        group.push(scope);
        scopes.set(keyId, group);
    }

    const items = results[0].results.map((key) => ({
        ...key,
        scopes: scopes.get(String(key.id)) ?? [],
    }));

    return json({ items, total: items.length });
}

/**
 * Validate resource ownership and atomically create a key with its grants.
 * @param request - The JSON request containing the token name, scopes, and expiration.
 * @param env - The Worker bindings used to validate resources and persist the token.
 * @returns A response containing the plaintext token for this one creation request only.
 */
export async function createKey(request: Request, env: Env) {
    const data = await body(request);
    const name = text(data.name, 'Name', 100).trim();

    if (!Array.isArray(data.scopes) || data.scopes.length < 1) {
        fail(400, 'invalid_scopes', 'Provide at least one access scope.');
    }

    const scopes: Scope[] = [];
    const seen = new Set<string>();

    for (const item of data.scopes) {
        if (!isPlainObject(item)) {
            fail(400, 'invalid_scope', 'Invalid access scope.');
        }

        const projectId = text(item.project_id, 'Project ID');
        const environmentId = text(item.environment_id, 'Environment ID');

        if (item.permission !== 'read' && item.permission !== 'write') {
            fail(400, 'invalid_permission', 'Permission must be read or write.');
        }

        if (projectId === '*' && environmentId !== '*') {
            fail(400, 'invalid_scope', 'All-project access must include all environments.');
        }

        const identity = JSON.stringify([projectId, environmentId]);

        if (seen.has(identity)) {
            fail(400, 'duplicate_scope', 'Duplicate access scope.');
        }

        seen.add(identity);
        scopes.push({
            project_id: projectId,
            environment_id: environmentId,
            permission: item.permission,
        });
    }

    // Resolve resources in two queries regardless of the number of requested grants.
    const resources = await env.DB.batch<{ id: string; project_id?: string }>([
        env.DB.prepare('SELECT id FROM projects WHERE id IN (SELECT value FROM json_each(?))').bind(
            JSON.stringify(uniq(scopes.map((scope) => scope.project_id).filter((id) => id !== '*'))),
        ),
        env.DB.prepare('SELECT id, project_id FROM environments WHERE id IN (SELECT value FROM json_each(?))').bind(
            JSON.stringify(uniq(scopes.map((scope) => scope.environment_id).filter((id) => id !== '*'))),
        ),
    ]);

    const projects = new Set(resources[0].results.map((project) => project.id));

    const environments = new Map(resources[1].results.map((environment) => [environment.id, environment.project_id]));

    for (const scope of scopes) {
        if (scope.project_id !== '*' && !projects.has(scope.project_id)) {
            fail(400, 'invalid_scope_project', 'The selected project does not exist.');
        }

        if (scope.environment_id !== '*' && environments.get(scope.environment_id) !== scope.project_id) {
            fail(400, 'invalid_scope_environment', 'The environment does not belong to the selected project.');
        }
    }

    let expiresAt: string | null = null;

    if (data.expires_at != null && data.expires_at !== '') {
        const date = text(data.expires_at, 'Expiration');
        const parsed = new Date(date);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
            fail(400, 'invalid_expiration', 'The expiration must be a valid date in YYYY-MM-DD format.');
        }

        if (date < new Date().toISOString().slice(0, 10)) {
            fail(400, 'invalid_expiration', 'The expiration date must be today or later (UTC).');
        }

        expiresAt = date;
    }

    const token = randomToken();
    const id = crypto.randomUUID();

    await env.DB.batch([
        env.DB.prepare('INSERT INTO api_keys (id, name, token, prefix, expires_at) VALUES (?, ?, ?, ?, ?)').bind(
            id,
            name,
            await digest(token),
            token.slice(0, 8),
            expiresAt,
        ),
        // Preserve nullable foreign keys internally while exposing explicit wildcards in the API.
        env.DB.prepare(
            `INSERT INTO api_key_scopes (id, api_key_id, project_id, environment_id, permission)
      SELECT json_extract(value, '$.id'), ?, NULLIF(json_extract(value, '$.project_id'), '*'),
        NULLIF(json_extract(value, '$.environment_id'), '*'), json_extract(value, '$.permission')
      FROM json_each(?)`,
        ).bind(id, JSON.stringify(scopes.map((scope) => ({ ...scope, id: crypto.randomUUID() })))),
    ]);

    return json({ id, name, token, expires_at: expiresAt, scopes }, 201);
}
