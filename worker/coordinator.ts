import { DurableObject } from 'cloudflare:workers';
import { configInput, errorResponse, fail, json, type Config, type ConfigInput, type Environment, type Project } from './common';
import { matchesWatchScope, readWatchChanges, WATCH_STATE_SQL, type WatchRange, type WatchRequest, type WatchState } from './watch';

/** Configuration commands retain optimistic concurrency independently of watch progress. */
type Mutation =
    | {
          environmentId: string;
          key?: string;
          operation: 'put' | 'delete' | 'restore' | 'remove-environment';
          expectedRevision: number | null;
          input?: ConfigInput;
          historyId?: string;
          actor: string;
      }
    | { operation: 'remove-project'; projectId: string };

/** Resource identities and public paths captured before deletion. */
type Change = {
    projectId: string;
    project: string;
    environmentId: string | null;
    environment: string | null;
    key: string | null;
    resource: 'project' | 'environment' | 'config';
    operation: 'create' | 'update' | 'delete' | 'restore';
};

/** One cancellable HTTP request waiting for a matching committed change. */
type Waiter = { scopes: WatchRange[]; wake: () => void };

/**
 * Coordinate configuration writes and cross-project watches for one deployment.
 * @remarks D1 is authoritative. Ordinary reads and account administration bypass this object.
 * This centralized application intentionally uses one coordinator for its small write workload.
 */
export class WatchCoordinator extends DurableObject<Env> {
    private queue: Promise<void> = Promise.resolve();
    private waiters = new Map<string, Waiter>();

    /**
     * Serialize D1 commands across awaits without holding a DO concurrency gate.
     * @param mutation - A validated command from an authorized Worker route.
     * @returns The public response, including client-safe failures.
     */
    async mutate(mutation: Mutation): Promise<Response> {
        const previous = this.queue;
        let release!: () => void;

        this.queue = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;

        try {
            return await this.apply(mutation);
        } catch (error) {
            return errorResponse(error);
        } finally {
            release();
        }
    }

    /**
     * Wake matching subscribers after the transaction commits.
     * @param change - The committed resource identities.
     */
    private notify(change: Change): void {
        for (const waiter of this.waiters.values()) {
            if (waiter.scopes.some((scope) => matchesWatchScope(scope, change))) {
                waiter.wake();
            }
        }
    }

    /**
     * Read a live environment rather than trusting middleware's earlier lookup.
     * @param id - The immutable environment identity.
     * @returns The environment and its project's public slug.
     */
    private async environment(id: string) {
        const environment = await this.env.DB.prepare(
            'SELECT e.*, p.slug AS project_slug FROM environments e JOIN projects p ON p.id = e.project_id WHERE e.id = ?',
        )
            .bind(id)
            .first<Environment & { project_slug: string }>();

        if (!environment) {
            fail(404, 'environment_not_found', 'The environment does not exist or has been deleted.');
        }

        return environment;
    }

    /**
     * Reserve a global revision only while previously read state remains current.
     * @param state - The clock read before inspecting the command target.
     * @param marker - A unique identity guarding all statements in this transaction.
     * @param predicate - Internal SQL protecting structural deletion.
     * @param parameters - Bindings for the internal condition.
     * @returns The first statement of the atomic mutation batch.
     */
    private advance(state: WatchState, marker: string, predicate = '1 = 1', parameters: string[] = []) {
        if (state.revision >= Number.MAX_SAFE_INTEGER) {
            fail(503, 'revision_limit_reached', 'The configuration revision limit has been reached.');
        }

        return this.env.DB.prepare(
            `
      UPDATE watch_state SET revision = revision + 1, last_mutation = ?
      WHERE id = 1 AND revision = ? AND (${predicate})
    `,
        ).bind(marker, state.revision, ...parameters);
    }

    /**
     * Commit the clock, resource, history, and durable notification together.
     * @param statements - Guarded statements beginning with the global compare-and-swap.
     * @param marker - The identity installed by the first statement.
     * @param change - Notification metadata retained after parent deletion.
     * @param now - The timestamp shared with configuration history.
     * @returns Whether this command acquired and committed its revision.
     */
    private async commit(statements: D1PreparedStatement[], marker: string, change: Change, now: string) {
        statements.push(
            this.env.DB.prepare(
                `
        INSERT INTO watch_changes (revision, project_id, project_slug, environment_id, environment_slug, config_key, resource, operation, created_at)
        SELECT revision, ?, ?, ?, ?, ?, ?, ?, ? FROM watch_state WHERE id = 1 AND last_mutation = ?
      `,
            ).bind(
                change.projectId,
                change.project,
                change.environmentId,
                change.environment,
                change.key,
                change.resource,
                change.operation,
                now,
                marker,
            ),
        );

        const results = await this.env.DB.batch(statements);

        if (!results[0].meta.changes) {
            return false;
        }

        this.notify(change);

        return true;
    }

    /**
     * Validate and execute a queued command against authoritative D1 state.
     * @param mutation - The command dispatched by the public resource route.
     * @returns A successful response, or throws a client-safe conflict.
     */
    private async apply(mutation: Mutation): Promise<Response> {
        // Read the clock first so stale target data cannot adopt a newer watermark.
        const state = (await this.env.DB.prepare(WATCH_STATE_SQL).first<WatchState>())!;
        const marker = crypto.randomUUID();
        const now = new Date().toISOString();

        if (mutation.operation === 'remove-project') {
            const project = await this.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(mutation.projectId).first<Project>();

            if (!project) {
                fail(404, 'project_not_found', 'The project does not exist.');
            }

            const committed = await this.commit(
                [
                    this.advance(state, marker, 'NOT EXISTS (SELECT 1 FROM environments WHERE project_id = ?)', [project.id]),
                    this.env.DB.prepare(
                        'DELETE FROM projects WHERE id = ? AND EXISTS (SELECT 1 FROM watch_state WHERE id = 1 AND last_mutation = ?)',
                    ).bind(project.id, marker),
                ],
                marker,
                {
                    projectId: project.id,
                    project: project.slug,
                    environmentId: null,
                    environment: null,
                    key: null,
                    resource: 'project',
                    operation: 'delete',
                },
                now,
            );

            if (!committed) {
                if (await this.env.DB.prepare('SELECT id FROM environments WHERE project_id = ? LIMIT 1').bind(project.id).first()) {
                    fail(409, 'project_not_empty', 'Delete all environments before deleting this project.');
                }

                fail(409, 'mutation_conflict', 'The configuration state has changed. Try again.');
            }

            return json({ revision: state.revision + 1 });
        }

        const { environmentId, expectedRevision } = mutation;
        const environment = await this.environment(environmentId);
        const change: Change = {
            projectId: environment.project_id,
            project: environment.project_slug,
            environmentId,
            environment: environment.slug,
            key: null,
            resource: 'environment',
            operation: 'delete',
        };

        if (mutation.operation === 'remove-environment') {
            const committed = await this.commit(
                [
                    this.advance(state, marker, 'NOT EXISTS (SELECT 1 FROM config_entries WHERE environment_id = ?)', [environmentId]),
                    this.env.DB.prepare(
                        'DELETE FROM environments WHERE id = ? AND EXISTS (SELECT 1 FROM watch_state WHERE id = 1 AND last_mutation = ?)',
                    ).bind(environmentId, marker),
                ],
                marker,
                change,
                now,
            );

            if (!committed) {
                if (
                    await this.env.DB.prepare('SELECT key FROM config_entries WHERE environment_id = ? LIMIT 1').bind(environmentId).first()
                ) {
                    fail(409, 'environment_not_empty', 'Delete all configuration before deleting this environment.');
                }

                fail(409, 'mutation_conflict', 'The configuration state has changed. Try again.');
            }

            return json({ revision: state.revision + 1 });
        }

        let key = mutation.key ?? '';
        let input = mutation.input;

        if (mutation.operation === 'restore') {
            const history = await this.env.DB.prepare(
                'SELECT * FROM config_history WHERE id = ? AND environment_id = ? AND (? IS NULL OR key = ?)',
            )
                .bind(mutation.historyId, environmentId, mutation.key ?? null, mutation.key ?? null)
                .first<Config>();

            if (!history) {
                fail(404, 'history_not_found', 'The history entry does not exist.');
            }

            key = history.key;
            input = configInput(history);
        }

        // Select public fields so unchanged saves return the same shape as configuration reads.
        const current = await this.env.DB.prepare(
            'SELECT key, value, type, description, revision, created_at, updated_at FROM config_entries WHERE environment_id = ? AND key = ?',
        )
            .bind(environmentId, key)
            .first<Omit<Config, 'environment_id'>>();

        if (expectedRevision === null && current && mutation.operation !== 'delete') {
            fail(409, 'config_already_exists', 'The configuration already exists.');
        }

        if (expectedRevision === null ? Boolean(current) : !current || current.revision !== expectedRevision) {
            fail(409, 'config_revision_conflict', 'The configuration has changed. Reload before saving.');
        }

        if (mutation.operation === 'delete' && !current) {
            fail(404, 'config_not_found', 'The configuration does not exist.');
        }

        if (
            current &&
            input &&
            mutation.operation === 'put' &&
            current.value === input.value &&
            current.type === input.type &&
            current.description === input.description
        ) {
            return json(current, 200, { ETag: `"${current.revision}"` });
        }

        const value = input ?? current!;
        const revision = state.revision + 1;
        const action =
            mutation.operation === 'restore' ? 'restore' : mutation.operation === 'delete' ? 'delete' : current ? 'update' : 'create';
        const statements = [this.advance(state, marker)];

        if (mutation.operation === 'delete') {
            statements.push(
                this.env.DB.prepare(
                    'DELETE FROM config_entries WHERE environment_id = ? AND key = ? AND EXISTS (SELECT 1 FROM watch_state WHERE id = 1 AND last_mutation = ?)',
                ).bind(environmentId, key, marker),
            );
        } else {
            statements.push(
                this.env.DB.prepare(
                    `
        INSERT INTO config_entries (environment_id, key, value, type, description, revision, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, revision, ?, ? FROM watch_state WHERE id = 1 AND last_mutation = ?
        ON CONFLICT(environment_id, key) DO UPDATE SET value = excluded.value, type = excluded.type,
          description = excluded.description, revision = excluded.revision, updated_at = excluded.updated_at
      `,
                ).bind(environmentId, key, value.value, value.type, value.description, now, now, marker),
            );
        }

        statements.push(
            this.env.DB.prepare(
                'UPDATE environments SET revision = (SELECT revision FROM watch_state WHERE id = 1) WHERE id = ? AND EXISTS (SELECT 1 FROM watch_state WHERE id = 1 AND last_mutation = ?)',
            ).bind(environmentId, marker),
            this.env.DB.prepare(
                `
        INSERT INTO config_history (id, environment_id, key, value, type, description, action, revision, actor, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, revision, ?, ? FROM watch_state WHERE id = 1 AND last_mutation = ?
      `,
            ).bind(
                crypto.randomUUID(),
                environmentId,
                key,
                value.value,
                value.type,
                value.description,
                action,
                mutation.actor,
                now,
                marker,
            ),
        );

        if (!(await this.commit(statements, marker, { ...change, key, resource: 'config', operation: action }, now))) {
            fail(409, 'mutation_conflict', 'The configuration state has changed. Try again.');
        }

        if (mutation.operation === 'delete') {
            return json({ revision });
        }

        return json(
            {
                key,
                ...value,
                revision,
                created_at: current?.created_at ?? now,
                updated_at: now,
            },
            current ? 200 : 201,
            { ETag: `"${revision}"` },
        );
    }

    /**
     * Wait on a trusted internal request carrying the public GET request's abort signal.
     * @param request - Authorized scopes, revision, and bounded timeout forwarded by the Worker.
     * @returns Relevant invalidations or an empty successful response on normal timeout.
     * @remarks Register before each read and recheck after every wake, including timeout.
     */
    async fetch(request: Request): Promise<Response> {
        try {
            const { scopes, revision, timeout } = await request.json<WatchRequest>();

            const id = crypto.randomUUID();
            let timedOut = false;
            const wake = () => {
                this.waiters.get(id)?.wake();
            };
            const timer = setTimeout(() => {
                timedOut = true;
                wake();
            }, timeout * 1000);

            request.signal.addEventListener('abort', wake, { once: true });

            try {
                while (true) {
                    if (request.signal.aborted) {
                        return new Response(null, { status: 499 });
                    }

                    let resolve!: () => void;
                    const signal = new Promise<void>((done) => {
                        resolve = done;
                    });

                    this.waiters.set(id, { scopes, wake: resolve });

                    const result = await readWatchChanges(this.env.DB, scopes, revision);

                    if (result.changes.length || timedOut) {
                        return json(result);
                    }

                    // A matching write during the read resolves this already-registered promise.
                    await signal;
                }
            } finally {
                clearTimeout(timer);
                this.waiters.delete(id);
                request.signal.removeEventListener('abort', wake);
            }
        } catch (error) {
            return errorResponse(error);
        }
    }
}
