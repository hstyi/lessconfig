import { useTranslation } from 'react-i18next';
import { Button } from '@cloudflare/kumo/components/button';
import { date, type History } from '../lib/api.ts';
import { useApiList } from '../hooks/useApiList';
import { Empty } from './Empty';
import { ErrorMessage } from './ErrorMessage';
import { ListSkeleton } from './ListSkeleton';
import { LoadingIndicator } from './LoadingIndicator';

/** Share the complete history table between the environment tab and a key-specific dialog. */
export function HistoryList({
    base,
    configKey,
    revision,
    onInspect,
}: {
    base: string;
    configKey?: string;
    revision: number;
    onInspect: (record: History) => void;
}) {
    const { t } = useTranslation();

    const list = useApiList<History>(
        configKey === undefined ? `${base}/history` : `${base}/configurations/${encodeURIComponent(configKey)}/history`,
        { revision },
    );

    const history = list.data ?? { items: [], total: 0 };

    const actions: Record<string, string> = {
        create: 'Create',
        update: 'Update',
        delete: 'Delete',
        restore: 'Restore',
    };

    return (
        <section
            aria-label={t('Configuration history')}
            aria-busy={list.loading}
            className="overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line"
        >
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-5">
                <div>
                    <h3 className="text-base font-semibold">{t('Configuration history')}</h3>
                    <p className="mt-1 text-kumo-subtle">{t('Restoring creates a new version and preserves existing history.')}</p>
                </div>
                <LoadingIndicator active={list.loading && Boolean(list.data)} label={t('Updating history…')} />
            </div>
            <ErrorMessage error={list.error} />
            {list.loading && !list.data ? (
                <ListSkeleton label={t('Loading history…')} />
            ) : history.items.length ? (
                <div className="overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:text-base [&_th]:border-y [&_th]:border-kumo-line [&_th]:bg-kumo-tint [&_th]:px-5 [&_th]:py-3 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-kumo-line [&_td]:px-5 [&_td]:py-3.5 [&_tr:last-child_td]:border-b-0 [&_tbody_tr:hover]:bg-kumo-tint/40">
                    <table>
                        <thead>
                            <tr>
                                <th>{t('Configuration key')}</th>
                                <th>{t('Action')}</th>
                                <th>{t('Version')}</th>
                                <th>{t('Actor')}</th>
                                <th>{t('Time')}</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {history.items.map((item) => (
                                <tr key={item.id}>
                                    <td className="font-mono text-[0.9em]">{item.key}</td>
                                    <td>
                                        <span
                                            data-action={item.action}
                                            className="inline-block rounded px-2 py-0.5 whitespace-nowrap data-[action=create]:text-emerald-700 data-[action=create]:bg-emerald-50 data-[action=update]:text-blue-700 data-[action=update]:bg-blue-50 data-[action=delete]:text-red-700 data-[action=delete]:bg-red-50 data-[action=restore]:text-amber-800 data-[action=restore]:bg-amber-50"
                                        >
                                            {t(actions[item.action])}
                                        </span>
                                    </td>
                                    <td className="font-mono text-[0.9em]">v{item.revision}</td>
                                    <td>{item.actor}</td>
                                    <td className="text-kumo-subtle whitespace-nowrap">{date(item.created_at)}</td>
                                    <td className="text-right">
                                        <Button variant="ghost" onClick={() => onInspect(item)}>
                                            {t('View version')}
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : !list.error ? (
                <Empty
                    title={t('No history yet')}
                    description={t('Configuration changes will appear here when you create, edit, delete, or restore a value.')}
                />
            ) : null}
            <div className="border-t border-kumo-line px-5 py-4 text-kumo-subtle">{t('Item count', { count: history.total })}</div>
        </section>
    );
}
