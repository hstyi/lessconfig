import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@cloudflare/kumo/components/button';
import { api, message, revisionHeaders, type Config } from '../lib/api.ts';
import { Modal } from './Modal';

/** Delete a confirmed snapshot of selected revisions and retain failures for review or retry. */
export function BulkDeleteDialog({
    base,
    configs,
    onClose,
    onDeleted,
}: {
    base: string;
    configs: Config[];
    onClose: () => void;
    onDeleted: (keys: string[]) => void;
}) {
    const { t } = useTranslation();
    const [previousConfigs, setPreviousConfigs] = useState(configs);
    const [pending, setPending] = useState(configs);
    const [failures, setFailures] = useState<Map<string, string>>(new Map());
    const [busy, setBusy] = useState(false);
    const [completed, setCompleted] = useState(0);

    // Reset before displaying a new confirmation, without changing its captured revisions on refresh.
    if (configs !== previousConfigs) {
        setPreviousConfigs(configs);
        setPending(configs);
        setFailures(new Map());
        setCompleted(0);
    }

    /** Limit concurrent requests and preserve If-Match checks for every selected record. */
    async function remove() {
        setBusy(true);
        setFailures(new Map());
        setCompleted(0);

        const deleted: string[] = [];
        const errors = new Map<string, string>();

        try {
            for (let start = 0; start < pending.length; start += 4) {
                await Promise.all(
                    pending.slice(start, start + 4).map(async (config) => {
                        try {
                            await api(`${base}/configurations/${encodeURIComponent(config.key)}`, {
                                method: 'DELETE',
                                headers: revisionHeaders(config.revision),
                            });
                            deleted.push(config.key);
                        } catch (error) {
                            errors.set(config.key, message(error));
                        }
                    }),
                );
                setCompleted(Math.min(start + 4, pending.length));
            }

            setPending(pending.filter((config) => errors.has(config.key)));
            setFailures(errors);
            onDeleted(deleted);

            if (!errors.size) {
                onClose();
            }
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            open={configs.length > 0}
            onClose={() => {
                if (!busy) {
                    onClose();
                }
            }}
            title={t('Delete records', { count: pending.length })}
            description={t('Connected clients will be notified. You can restore deleted configuration from history.')}
        >
            {failures.size > 0 && (
                <p role="alert" className="mb-3 text-red-700">
                    {t('Deletion failed count', { count: failures.size })}
                </p>
            )}
            <ul className="max-h-60 space-y-3 overflow-y-auto rounded-md bg-kumo-tint px-4 py-3 text-base">
                {pending.map((config) => (
                    <li key={config.key} className="wrap-anywhere">
                        <span className="font-mono text-[0.9em]">{config.key}</span>
                        {failures.has(config.key) && <p className="mt-1 text-red-700">{t(failures.get(config.key)!)}</p>}
                    </li>
                ))}
            </ul>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5 border-t border-kumo-line pt-5">
                {busy && (
                    <span role="status" className="mr-auto text-kumo-subtle">
                        {t('Deleting progress', { completed, total: pending.length })}
                    </span>
                )}
                <Button disabled={busy} onClick={onClose}>
                    {t('Cancel')}
                </Button>
                <Button variant="destructive" disabled={busy || !pending.length} loading={busy} onClick={() => void remove()}>
                    {t('Delete records', { count: pending.length })}
                </Button>
            </div>
        </Modal>
    );
}
