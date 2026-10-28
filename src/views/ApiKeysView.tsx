import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { PlusIcon, KeyIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import { api, date, type ApiKey } from '../lib/api.ts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Empty } from '../components/Empty';
import { ErrorMessage } from '../components/ErrorMessage';
import { ListSkeleton } from '../components/ListSkeleton';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useApiList } from '../hooks/useApiList';

/** Browse all API token metadata, filter by name, and delete existing tokens. */
export function ApiKeysView() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [tick, setTick] = useState(0);
    const [search, setSearch] = useState('');
    const list = useApiList<ApiKey>('/api-keys', { revision: tick });
    const data = list.data ?? { items: [], total: 0 };
    const items = data.items.filter((key) => key.name.toLowerCase().includes(search.toLowerCase()));
    const [deleting, setDeleting] = useState<ApiKey | null>(null);

    return (
        <>
            <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold leading-tight md:text-[28px]">{t('API Tokens')}</h1>
                    <p className="mt-2 text-kumo-subtle">{t('Manage access tokens for applications and integrations.')}</p>
                </div>
                <div className="flex items-center gap-3">
                    <LoadingIndicator active={list.loading && Boolean(list.data)} label={t('Updating API tokens…')} />
                    <Button variant="primary" icon={PlusIcon} onClick={() => navigate('/api-keys/new')}>
                        {t('Create API token')}
                    </Button>
                </div>
            </header>
            <ErrorMessage error={t(list.error)} />
            <section
                aria-label={t('API Tokens')}
                aria-busy={list.loading}
                className="overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line"
            >
                <div className="flex items-center justify-between gap-3 p-5">
                    <Input
                        aria-label={t('Search API tokens')}
                        placeholder={t('Search API tokens…')}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    <Button
                        variant="ghost"
                        shape="square"
                        icon={ArrowClockwiseIcon}
                        aria-label={t('Refresh API tokens')}
                        onClick={() => setTick((value) => value + 1)}
                    />
                </div>
                {list.loading && !list.data ? (
                    <ListSkeleton label={t('Loading API tokens…')} />
                ) : items.length ? (
                    <div className="overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border-y [&_th]:border-kumo-line [&_th]:bg-kumo-tint [&_th]:px-5 [&_th]:py-3 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-kumo-line [&_td]:px-5 [&_td]:py-3.5 [&_tr:last-child_td]:border-b-0 [&_tbody_tr:hover]:bg-kumo-tint/40">
                        <table>
                            <thead>
                                <tr>
                                    <th>{t('Name / token')}</th>
                                    <th>{t('Permissions and resources')}</th>
                                    <th>{t('Status')}</th>
                                    <th>{t('Last used')}</th>
                                    <th>{t('Expires')}</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((key) => {
                                    const expired = Boolean(
                                        key.expires_at && key.expires_at < new Date(list.updatedAt).toISOString().slice(0, 10),
                                    );

                                    return (
                                        <tr key={key.id}>
                                            <td>
                                                <div className="flex items-center gap-2 font-medium [&_svg]:text-kumo-subtle">
                                                    <KeyIcon size={18} />
                                                    <span>{key.name}</span>
                                                </div>
                                                <div className="font-mono text-[0.9em] text-kumo-subtle mt-1.5">{key.prefix}••••••••</div>
                                            </td>
                                            <td>
                                                <div className="flex flex-col gap-1.5 [&>span]:flex [&>span]:flex-wrap [&>span]:items-center [&>span]:gap-2">
                                                    {key.scopes.length ? (
                                                        key.scopes.map((s, i) => (
                                                            <span key={i}>
                                                                <span
                                                                    data-permission={s.permission}
                                                                    className="inline-block rounded px-2 py-0.5 whitespace-nowrap bg-blue-50 text-blue-700 data-[permission=write]:bg-amber-50 data-[permission=write]:text-amber-800"
                                                                >
                                                                    {s.permission === 'read' ? t('Read') : t('Edit')}
                                                                </span>
                                                                {s.project_id === '*' ? t('All projects') : s.project_name}{' '}
                                                                <span className="text-kumo-subtle">/</span>{' '}
                                                                {s.environment_slug ?? t('All environments')}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-kumo-subtle">
                                                            {t('The granted project or environment was deleted')}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                <span
                                                    data-inactive={expired}
                                                    className="inline-block rounded bg-emerald-50 px-2 py-0.5 whitespace-nowrap text-emerald-700 data-[inactive=true]:bg-kumo-tint data-[inactive=true]:text-kumo-subtle"
                                                >
                                                    {expired ? t('Expired') : t('Active')}
                                                </span>
                                            </td>
                                            <td className="text-kumo-subtle whitespace-nowrap">{date(key.last_used_at)}</td>
                                            <td className="text-kumo-subtle whitespace-nowrap">{key.expires_at ?? t('No expiration')}</td>
                                            <td className="text-right">
                                                <Button variant="ghost" onClick={() => setDeleting(key)}>
                                                    {t('Delete')}
                                                </Button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <Empty
                        title={t(search ? 'No matching API tokens' : 'Create your first API token')}
                        description={t('Give each application its own API token and choose the projects and environments it can access.')}
                        action={
                            <Button icon={PlusIcon} onClick={() => navigate('/api-keys/new')}>
                                {t('Create API token')}
                            </Button>
                        }
                    />
                )}
                <div className="border-t border-kumo-line px-5 py-4 text-kumo-subtle">{t('Item count', { count: items.length })}</div>
            </section>
            <ConfirmDialog
                open={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                title={t('Delete API token')}
                description={t(
                    'Delete “{{value1}}”? This token will lose access to configuration. Pending watches will recheck access before returning.',
                    { value1: deleting?.name ?? '' },
                )}
                onConfirm={async () => {
                    if (deleting) {
                        await api(`/api-keys/${deleting.id}`, { method: 'DELETE' });
                        setTick((value) => value + 1);
                    }
                }}
            />
        </>
    );
}
