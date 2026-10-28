import { beforeEach, expect, test } from 'vitest';
import { env } from 'cloudflare:workers';
import { createScheduledController } from 'cloudflare:test';
import worker from '../../worker';

const scheduledTime = '2026-10-28T00:00:00.000Z';
const cutoff = '2026-10-21T00:00:00.000Z';
const expired = '2026-10-20T23:59:59.999Z';
const recent = '2026-10-27T23:00:00.000Z';

/** Reset only the isolated test database's watch log and singleton clock. */
beforeEach(async () => {
    await env.DB.batch([
        env.DB.prepare('DELETE FROM watch_changes'),
        env.DB.prepare("UPDATE watch_state SET revision = 0, minimum_revision = 0, last_mutation = 'unchanged' WHERE id = 1"),
    ]);
});

/**
 * Seed a contiguous log independently of live resource rows, as deletion events require.
 * @param timestamps - Commit timestamps ordered by global revision.
 */
async function seed(timestamps: string[]): Promise<void> {
    await env.DB.batch([
        ...timestamps.map((timestamp, index) =>
            env.DB.prepare(
                `INSERT INTO watch_changes (revision, project_id, project_slug, environment_id, environment_slug, config_key, resource, operation, created_at)
                 VALUES (?, 'project-id', 'project', 'environment-id', 'prod', ?, 'config', 'update', ?)`,
            ).bind(index + 1, `key-${index + 1}`, timestamp),
        ),
        env.DB.prepare('UPDATE watch_state SET revision = ? WHERE id = 1').bind(timestamps.length),
    ]);
}

/**
 * Invoke the exported scheduled handler against real D1 with a controlled trigger time.
 * @param time - The scheduled UTC timestamp; delayed or repeated deliveries use the same time.
 */
async function runScheduled(time = scheduledTime): Promise<void> {
    await worker.scheduled(createScheduledController({ scheduledTime: new Date(time), cron: '0 0 */3 * *' }), env);
}

/** Read the durable clock and recovery boundary together for transaction assertions. */
async function state() {
    return env.DB.prepare('SELECT revision, minimum_revision, last_mutation FROM watch_state WHERE id = 1').first();
}

/** Read retained revisions in their client-visible order. */
async function revisions() {
    return (await env.DB.prepare('SELECT revision FROM watch_changes ORDER BY revision').all<{ revision: number }>()).results.map(
        (row) => row.revision,
    );
}

test('retains the exact seven-day boundary and does not rewind on repeated or older scheduled events', async () => {
    await seed([expired, cutoff, recent]);
    await runScheduled();

    expect(await revisions()).toEqual([2, 3]);
    expect(await state()).toEqual({ revision: 3, minimum_revision: 1, last_mutation: 'unchanged' });

    await runScheduled();
    await runScheduled('2026-10-25T00:00:00.000Z');

    expect(await revisions()).toEqual([2, 3]);
    expect(await state()).toEqual({ revision: 3, minimum_revision: 1, last_mutation: 'unchanged' });
});

test('handles a month-start Cron Trigger without applying a second schedule', async () => {
    await seed([expired]);
    await runScheduled('2026-11-01T00:00:00.000Z');

    expect(await revisions()).toEqual([]);
    expect(await state()).toEqual({ revision: 1, minimum_revision: 1, last_mutation: 'unchanged' });
});

test('cleans an inactive log completely and safely handles an empty database', async () => {
    await runScheduled();
    expect(await state()).toEqual({ revision: 0, minimum_revision: 0, last_mutation: 'unchanged' });

    await seed([expired, expired]);
    await runScheduled();

    expect(await revisions()).toEqual([]);
    expect(await state()).toEqual({ revision: 2, minimum_revision: 2, last_mutation: 'unchanged' });

    await runScheduled();
    expect(await state()).toEqual({ revision: 2, minimum_revision: 2, last_mutation: 'unchanged' });
});

test('preserves a complete resumable suffix when commit timestamps are out of order', async () => {
    await seed([expired, recent, expired]);
    await runScheduled();

    expect(await revisions()).toEqual([2, 3]);
    expect(await state()).toEqual({ revision: 3, minimum_revision: 1, last_mutation: 'unchanged' });
});

test('rolls the recovery boundary back when deletion fails and permits a successful retry', async () => {
    await seed([expired, recent]);
    await env.DB.exec(
        "CREATE TRIGGER reject_cleanup_test BEFORE DELETE ON watch_changes BEGIN SELECT RAISE(ABORT, 'cleanup test failure'); END;",
    );

    try {
        await expect(runScheduled()).rejects.toThrow('cleanup test failure');
        expect(await revisions()).toEqual([1, 2]);
        expect(await state()).toEqual({ revision: 2, minimum_revision: 0, last_mutation: 'unchanged' });
    } finally {
        await env.DB.exec('DROP TRIGGER reject_cleanup_test');
    }

    await runScheduled();
    expect(await revisions()).toEqual([2]);
    expect(await state()).toEqual({ revision: 2, minimum_revision: 1, last_mutation: 'unchanged' });
});
