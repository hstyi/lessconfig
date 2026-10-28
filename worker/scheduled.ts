const WATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Remove expired watch invalidations independently of API reads and writes.
 * @param controller - The Cron Trigger event, including its scheduled execution time.
 * @param env - The Worker bindings containing the authoritative D1 database.
 * @remarks The recovery boundary and log deletion commit together. Configuration values,
 * version history, the global revision, and the mutation marker remain unchanged.
 */
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const cutoff = new Date(controller.scheduledTime - WATCH_RETENTION_MS).toISOString();

    await env.DB.batch([
        // Stop before the first retained event even if timestamps are not monotonic.
        // Deleting only a prefix keeps every revision at or above the boundary resumable.
        env.DB.prepare(
            `
            UPDATE watch_state
            SET minimum_revision = MAX(minimum_revision,
                COALESCE((SELECT MIN(revision) - 1 FROM watch_changes WHERE created_at >= ?), revision))
            WHERE id = 1
            `,
        ).bind(cutoff),
        env.DB.prepare('DELETE FROM watch_changes WHERE revision <= (SELECT minimum_revision FROM watch_state WHERE id = 1)'),
    ]);
}
