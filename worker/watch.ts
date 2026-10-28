import { configKey, fail, isAdmin, slug, type Principal } from './common';

/** One project, environment, or configuration selected by its immutable public path. */
export type WatchScope = { project: string; environment: string | null; key: string | null };

/** Public selection: explicit resource paths or all ranges readable by the credential. */
export type WatchSelection = WatchScope[] | '*';

/** Authorized identity patterns; '*' includes future projects and null includes descendants. */
export type WatchRange = { projectId: string; environmentId: string | null; key: string | null };

/** Resource identities resolved before authorization and retained for a pending request. */
export type ResolvedWatchScope = WatchScope & WatchRange;

/** The durable synchronization position and the oldest position still resumable. */
export type WatchState = { revision: number; minimum_revision: number };

/** A compact invalidation; configuration content is fetched through the read API. */
export type WatchChange = {
    revision: number;
    project: string;
    environment: string | null;
    key: string | null;
    resource: 'project' | 'environment' | 'config';
    type: 'created' | 'updated' | 'deleted' | 'restored';
};

/** Public long-poll result. The revision covers every requested scope, including empty ones. */
export type WatchResult = { revision: number; changes: WatchChange[] };

/** Trusted Worker-to-coordinator payload; HTTP forwarding preserves cancellation. */
export type WatchRequest = {
    scopes: WatchRange[];
    revision: number;
    timeout: number;
};

/** Read the clock in the same D1 batch as scope resolution or the matching change log. */
export const WATCH_STATE_SQL = 'SELECT revision, minimum_revision FROM watch_state WHERE id = 1';

/**
 * Accept the standalone wildcard or normalize repeated explicit scope parameters.
 * @param parameters - The public URL query parameters.
 * @returns The wildcard or validated paths in deterministic order without duplicates or covered descendants.
 */
export function parseWatchScopes(parameters: URLSearchParams): WatchSelection {
    const values = parameters.getAll('scopes');

    if (!values.length) {
        fail(400, 'watch_scopes_required', 'Provide at least one scopes query parameter.');
    }

    if (values.includes('*')) {
        if (values.length !== 1) {
            fail(400, 'invalid_watch_scope', 'The wildcard scope must be used alone.');
        }

        return '*';
    }

    const scopes = new Map<string, WatchScope>();

    for (const value of values) {
        const parts = value.split('/');

        if (parts.length > 3 || parts.some((part) => !part)) {
            fail(400, 'invalid_watch_scope', 'Scopes must use *, project, project/environment, or project/environment/key.');
        }

        scopes.set(value, {
            project: slug(parts[0]),
            environment: parts.length > 1 ? slug(parts[1]) : null,
            key: parts.length > 2 ? configKey(parts[2]) : null,
        });
    }

    return [...scopes.entries()]
        .filter(
            ([, scope]) =>
                !(scope.environment !== null && scopes.has(scope.project)) &&
                !(scope.key !== null && scopes.has(`${scope.project}/${scope.environment}`)),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, scope]) => scope);
}

/**
 * Read a bounded integer without accepting duplicate parameters or numeric coercions.
 * @param parameters - The public URL query parameters.
 * @param name - The parameter name to read.
 * @param fallback - The default value; omission otherwise fails validation.
 * @param maximum - The largest accepted integer.
 * @returns A nonnegative safe integer.
 */
export function watchInteger(parameters: URLSearchParams, name: string, fallback?: number, maximum = Number.MAX_SAFE_INTEGER): number {
    const values = parameters.getAll(name);
    const value = values[0] ?? (fallback === undefined ? '' : String(fallback));
    const number = Number(value);

    if (values.length > 1 || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(number) || number > maximum) {
        fail(400, 'invalid_watch_parameters', `${name} must be a nonnegative integer no greater than ${maximum}.`);
    }

    return number;
}

/**
 * Resolve many scopes with one JSON parameter instead of exceeding D1's bind limit.
 * @param db - The authoritative D1 binding.
 * @param scopes - The validated public scope paths.
 * @returns A statement usable alone or inside a watch initialization batch.
 */
export function scopeStatement(db: D1Database, scopes: WatchScope[]): D1PreparedStatement {
    return db
        .prepare(
            `
    SELECT json_extract(s.value, '$.project') AS project,
      json_extract(s.value, '$.environment') AS environment,
      json_extract(s.value, '$.key') AS key,
      p.id AS projectId, e.id AS environmentId
    FROM json_each(?) s
    LEFT JOIN projects p ON p.slug = json_extract(s.value, '$.project')
    LEFT JOIN environments e ON e.project_id = p.id
      AND e.slug = json_extract(s.value, '$.environment')
    ORDER BY CAST(s.key AS INTEGER)
  `,
        )
        .bind(JSON.stringify(scopes));
}

/**
 * Require explicit paths to resolve to existing projects and environments.
 * @param scopes - Resource identities returned by the scope lookup.
 * @throws ApiError - If a requested project or environment does not exist.
 */
function validateResolvedWatchScopes(scopes: ResolvedWatchScope[]): void {
    for (const scope of scopes) {
        if (!scope.projectId) {
            fail(404, 'project_not_found', 'The project does not exist.');
        }

        if (scope.environment !== null && !scope.environmentId) {
            fail(404, 'environment_not_found', 'The environment does not exist.');
        }
    }
}

/**
 * Require access to every requested identity pattern, including future descendants.
 * @param principal - The current authenticated account or API token.
 * @param scopes - Identity patterns retained throughout the pending request.
 * @throws ApiError - If no readable range exists or any pattern exceeds the current grants.
 */
export function authorizeWatchScopes(principal: Principal, scopes: WatchRange[]): void {
    if (!scopes.length) {
        fail(403, 'watch_scope_access_denied', 'Read access to at least one scope is required.');
    }

    for (const scope of scopes) {
        if (
            !isAdmin(principal) &&
            !(
                principal.kind === 'key' &&
                principal.scopes.some(
                    (grant) =>
                        (grant.project_id === '*' || grant.project_id === scope.projectId) &&
                        (grant.environment_id === '*' || (scope.environmentId !== null && grant.environment_id === scope.environmentId)),
                )
            )
        ) {
            fail(403, 'watch_scope_access_denied', 'Read access to the complete requested scope is required.');
        }
    }
}

/**
 * Preserve grant patterns instead of enumerating resources that currently exist.
 * @param principal - The credential whose complete readable range was requested.
 * @returns Authorized patterns that also match future resources covered by the grants.
 */
function allWatchScopes(principal: Principal): WatchRange[] {
    const scopes: WatchRange[] = isAdmin(principal)
        ? [{ projectId: '*', environmentId: null, key: null }]
        : principal.scopes.map((grant) => ({
              projectId: grant.project_id,
              environmentId: grant.environment_id === '*' ? null : grant.environment_id,
              key: null,
          }));

    authorizeWatchScopes(principal, scopes);

    return scopes;
}

/**
 * Resolve public selections to the authorized patterns used by SQL and DO notifications.
 * @param db - The authoritative D1 binding.
 * @param selection - Explicit paths or the standalone wildcard.
 * @param principal - The current authenticated credential.
 * @returns Authorized patterns retained for the duration of a long poll.
 */
export async function resolveWatchScopes(db: D1Database, selection: WatchSelection, principal: Principal): Promise<WatchRange[]> {
    if (selection === '*') {
        return allWatchScopes(principal);
    }

    const { results } = await scopeStatement(db, selection).all<ResolvedWatchScope>();

    validateResolvedWatchScopes(results);
    authorizeWatchScopes(principal, results);

    return results;
}

/**
 * Match both configuration events and deletion of an ancestor resource.
 * @param scope - An authorized identity pattern, including any wildcard project grant.
 * @param change - The identities of a committed change.
 * @returns Whether the pending subscriber must recheck D1.
 */
export function matchesWatchScope(
    scope: WatchRange,
    change: { projectId: string; environmentId: string | null; key: string | null },
): boolean {
    return (
        (scope.projectId === '*' || scope.projectId === change.projectId) &&
        (scope.environmentId === null || change.environmentId === null || scope.environmentId === change.environmentId) &&
        (scope.key === null || change.key === null || scope.key === change.key)
    );
}

/**
 * Capture an authorized starting position before clients read configuration through resource endpoints.
 * @param db - The authoritative D1 binding; replica reads require a separate consistency design.
 * @param scopes - The normalized public ranges.
 * @param principal - The account or API token initializing the subscription.
 * @returns The current global revision and empty changes without registering a long poll.
 */
export async function initializeWatch(db: D1Database, scopes: WatchSelection, principal: Principal): Promise<WatchResult> {
    if (scopes === '*') {
        allWatchScopes(principal);

        const state = await db.prepare(WATCH_STATE_SQL).first<WatchState>();

        return { revision: state!.revision, changes: [] };
    }

    const results = await db.batch([scopeStatement(db, scopes), db.prepare(WATCH_STATE_SQL)]);
    const resolved = results[0].results as ResolvedWatchScope[];

    validateResolvedWatchScopes(resolved);
    authorizeWatchScopes(principal, resolved);

    const state = results[1].results[0] as WatchState;

    return { revision: state.revision, changes: [] };
}

/**
 * Return the latest invalidation per resource and a watermark covering all scopes.
 * @param db - The authoritative D1 binding.
 * @param scopes - The fully authorized resolved ranges.
 * @param revision - The last position successfully processed by the client.
 * @returns A consistent change set, coalescing intermediate edits to the same resource.
 */
export async function readWatchChanges(db: D1Database, scopes: WatchRange[], revision: number): Promise<WatchResult> {
    const results = await db.batch([
        db.prepare(WATCH_STATE_SQL),
        db
            .prepare(
                `
      SELECT revision, project_slug AS project, environment_slug AS environment,
        config_key AS key, resource,
        CASE operation WHEN 'create' THEN 'created' WHEN 'update' THEN 'updated'
          WHEN 'delete' THEN 'deleted' ELSE 'restored' END AS type
      FROM watch_changes WHERE revision IN (
        SELECT MAX(c.revision) FROM watch_changes c
        WHERE c.revision > ? AND EXISTS (
          SELECT 1 FROM json_each(?) s
          WHERE (json_extract(s.value, '$.projectId') = '*' OR c.project_id = json_extract(s.value, '$.projectId'))
            AND (json_extract(s.value, '$.environmentId') IS NULL OR c.environment_id IS NULL OR c.environment_id = json_extract(s.value, '$.environmentId'))
            AND (json_extract(s.value, '$.key') IS NULL OR c.config_key IS NULL OR c.config_key = json_extract(s.value, '$.key'))
        ) GROUP BY c.project_id, c.environment_id, c.config_key, c.resource
      ) ORDER BY revision ASC
    `,
            )
            .bind(revision, JSON.stringify(scopes)),
    ]);

    const state = results[0].results[0] as WatchState;
    if (revision < state.minimum_revision) {
        fail(
            410,
            'revision_expired',
            'The revision is no longer available. Initialize watch without a revision, then reload configuration.',
        );
    }

    if (revision > state.revision) {
        fail(
            409,
            'revision_ahead',
            'The revision is ahead of the current state. Initialize watch without a revision, then reload configuration.',
        );
    }

    return { revision: state.revision, changes: results[1].results as WatchChange[] };
}
