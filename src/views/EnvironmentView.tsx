import { useTranslation } from 'react-i18next';
import { IDENTIFIER_PATTERN } from '../../shared/identifiers';
import { useCallback, useState, type SubmitEvent } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { Select } from '@cloudflare/kumo/components/select';
import { Checkbox } from '@cloudflare/kumo/components/checkbox';
import { Popover } from '@cloudflare/kumo/components/popover';
import {
    PlusIcon,
    MagnifyingGlassIcon,
    ArrowClockwiseIcon,
    FileCodeIcon,
    ClockCounterClockwiseIcon,
    TrashIcon,
    DownloadSimpleIcon,
    PencilSimpleIcon,
    ArrowCounterClockwiseIcon,
} from '@phosphor-icons/react';
import {
    ApiError,
    api,
    date,
    environmentPath,
    message,
    revisionHeaders,
    typeLabels,
    type Config,
    type ConfigType,
    type Environment,
    type History,
    type HistoryDetail,
    type ListResponse,
    type Project,
} from '../lib/api.ts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BulkDeleteDialog } from '../components/BulkDeleteDialog';
import { ImportConfigsPopover } from '../components/ImportConfigsPopover';
import { ConfigDiff } from '../components/ConfigDiff';
import { HistoryList } from '../components/HistoryList';
import { ConfigEditor } from '../components/ConfigEditor';
import { CopyButton } from '../components/CopyButton';
import { Empty } from '../components/Empty';
import { ErrorMessage } from '../components/ErrorMessage';
import { Modal } from '../components/Modal';
import { ListSkeleton } from '../components/ListSkeleton';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useWatchedConfigs } from '../hooks/useWatchedConfigs';

/** The editor buffer and the revision on which an update is based. */
type Draft = {
    key: string;
    value: string;
    type: ConfigType;
    description: string;
    revision?: number;
};

const emptyDraft: Draft = { key: '', value: '', type: 'text', description: '' };

const actionLabels: Record<string, string> = {
    create: 'Create',
    update: 'Update',
    delete: 'Delete',
    restore: 'Restore',
};

/** Edit, inspect, and watch an environment through the same public API as clients. */
export function EnvironmentView({ project, environment, onChange }: { project: Project; environment: Environment; onChange: () => void }) {
    const { t } = useTranslation();
    const base = environmentPath(project, environment);
    const [tab, setTab] = useState<'configs' | 'history'>('configs');
    const [search, setSearch] = useState('');
    const [tick, setTick] = useState(0);

    const configs = useWatchedConfigs(base, `${project.slug}/${environment.slug}`, tick);

    const filtered = (configs.data?.items ?? []).filter((config) => config.key.includes(search));
    const data = { items: filtered, total: filtered.length };
    const [error, setError] = useState('');
    const { sync, revision } = configs;
    const [draft, setDraft] = useState<Draft>(emptyDraft);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorError, setEditorError] = useState('');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<Config | null>(null);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [previousConfigData, setPreviousConfigData] = useState(configs.data);
    const [bulkDeleteTargets, setBulkDeleteTargets] = useState<Config[]>([]);
    const [exportOpen, setExportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);

    if (configs.data !== previousConfigData) {
        setPreviousConfigData(configs.data);

        // Drop removed rows before rendering so a recreated key is not silently selected.
        const available = new Set(data.items.map((config) => config.key));

        setSelectedKeys((current) => {
            const next = new Set([...current].filter((key) => available.has(key)));

            return next.size === current.size ? current : next;
        });
    }

    const selectedConfigs = data.items.filter((config) => selectedKeys.has(config.key));
    const allSelected = data.items.length > 0 && selectedConfigs.length === data.items.length;
    const [historyKey, setHistoryKey] = useState<string | null>(null);
    const [selectedHistory, setSelectedHistory] = useState<HistoryDetail | null>(null);
    const [restoreRevision, setRestoreRevision] = useState<number | undefined>();

    const refresh = useCallback(() => {
        setTick((t) => t + 1);
        onChange();
    }, [onChange]);

    async function exportConfigs() {
        setExporting(true);
        setError('');
        try {
            const result = await api<ListResponse<Config>>(`${base}/configurations`);
            const entries = result.items.map(({ key, value, type, description }) => ({ key, value, type, description }));
            const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2) + '\n'], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${project.slug}-${environment.slug}-configs.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setExportOpen(false);
        } catch (error) {
            setError(message(error));
        } finally {
            setExporting(false);
        }
    }

    async function edit(config: Config) {
        try {
            setDraft(await api<Config>(`${base}/configurations/${encodeURIComponent(config.key)}`));
            setEditorError('');
            setEditorOpen(true);
        } catch (e) {
            setError(message(e));
        }
    }

    async function save(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true);
        setEditorError('');

        try {
            await api(`${base}/configurations/${encodeURIComponent(draft.key)}`, {
                method: 'PUT',
                headers: revisionHeaders(draft.revision),
                body: JSON.stringify({
                    value: draft.value,
                    type: draft.type,
                    description: draft.description,
                }),
            });
            setEditorOpen(false);
            refresh();
        } catch (e) {
            setEditorError(message(e));
        } finally {
            setSaving(false);
        }
    }

    async function inspectHistory(item: History) {
        try {
            const record = await api<HistoryDetail>(`${base}/configurations/${encodeURIComponent(item.key)}/history/${item.id}`);

            let current: Config | null = null;

            try {
                current = await api<Config>(`${base}/configurations/${encodeURIComponent(record.key)}`);
            } catch (e) {
                if (!(e instanceof ApiError && e.status === 404)) {
                    throw e;
                }
            }

            setRestoreRevision(current?.revision);
            setSelectedHistory(record);
            setEditorError('');
        } catch (e) {
            setError(message(e));
        }
    }

    const previousHistory = selectedHistory?.previous;

    const before =
        selectedHistory?.action === 'delete'
            ? selectedHistory.value
            : previousHistory && previousHistory.action !== 'delete'
              ? previousHistory.value
              : '';

    const after = selectedHistory?.action === 'delete' ? '' : (selectedHistory?.value ?? '');

    return (
        <>
            <div
                className="mb-6 flex flex-wrap items-center gap-5 border-b border-kumo-line [&>button]:-mb-px [&>button]:flex [&>button]:items-center [&>button]:gap-2 [&>button]:border-b-2 [&>button]:border-transparent [&>button]:py-3.5 [&>button]:text-kumo-subtle [&>button[aria-selected=true]]:border-kumo-brand [&>button[aria-selected=true]]:text-kumo-link"
                role="tablist"
                aria-label={t('Environment views')}
            >
                {(
                    [
                        ['configs', t('Configuration'), FileCodeIcon],
                        ['history', t('History'), ClockCounterClockwiseIcon],
                    ] as const
                ).map(([id, label, Icon]) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}

                        onClick={() => setTab(id)}
                    >
                        <Icon size={18} />
                        {label}
                        {id === 'configs' && <span className="rounded bg-kumo-tint px-1.5 text-kumo-subtle">{data.total}</span>}
                    </button>
                ))}
                <div className="ml-auto hidden items-center gap-2 text-kumo-subtle lg:flex [&_.font-mono]:pl-1.5">
                    <span
                        data-pending={sync !== 'Live'}
                        className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-600 data-[pending=true]:bg-amber-500"
                    />
                    {t(sync)}
                    <span className="font-mono text-[0.9em]">v{revision}</span>
                </div>
            </div>
            <ErrorMessage error={t(error || (tab === 'configs' ? configs.error : ''))} />
            {tab === 'configs' && (
                <section aria-label={t('Configuration')} aria-busy={configs.loading}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="relative w-full md:w-72 [&>svg]:pointer-events-none [&>svg]:absolute [&>svg]:top-2.5 [&>svg]:left-3 [&>svg]:z-1 [&>svg]:text-kumo-subtle [&_input]:w-full [&_input]:pl-9">
                            <MagnifyingGlassIcon size={18} />
                            <Input
                                aria-label={t('Search configuration keys')}
                                placeholder={t('Search configuration keys…')}
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setSelectedKeys(new Set());
                                }}
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <LoadingIndicator active={configs.loading && Boolean(configs.data)} label={t('Updating configuration…')} />
                            <Button
                                variant="secondary"
                                shape="square"
                                aria-label={t('Refresh configuration')}
                                disabled={configs.loading}
                                icon={ArrowClockwiseIcon}
                                onClick={() => setTick((t) => t + 1)}
                            />
                            <ImportConfigsPopover base={base} onImported={refresh} />
                            <Popover open={exportOpen} onOpenChange={setExportOpen}>
                                <Popover.Trigger render={<Button variant="secondary" icon={DownloadSimpleIcon} />}>
                                    {t('Export')}
                                </Popover.Trigger>
                                <Popover.Content align="start" className="w-[min(22rem,calc(100vw-2rem))] p-4">
                                    <Popover.Title>{t('Export configuration')}</Popover.Title>
                                    <Popover.Description className="mt-2">
                                        {t('Download all configuration in this environment as a JSON file ({{filename}}).', {
                                            filename: `${project.slug}-${environment.slug}-configs.json`,
                                        })}
                                    </Popover.Description>
                                    <div className="mt-4 flex justify-end">
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            icon={DownloadSimpleIcon}
                                            loading={exporting}
                                            disabled={exporting}
                                            onClick={() => void exportConfigs()}
                                        >
                                            {t('Export')}
                                        </Button>
                                    </div>
                                </Popover.Content>
                            </Popover>
                            <Button
                                variant="primary"
                                icon={PlusIcon}
                                onClick={() => {
                                    setDraft({ ...emptyDraft });
                                    setEditorError('');
                                    setEditorOpen(true);
                                }}
                            >
                                {t('Create configuration')}
                            </Button>
                        </div>
                    </div>
                    <div
                        data-testid="configuration-table-card"
                        className="mt-4 overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line"
                    >
                        {selectedConfigs.length > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
                                <div className="flex flex-wrap items-center gap-3 text-base">
                                    <span role="status">
                                        {t('Selected records', { selected: selectedConfigs.length, total: data.total })}
                                    </span>
                                    <Button variant="ghost" onClick={() => setSelectedKeys(new Set())}>
                                        {t('Clear selection')}
                                    </Button>
                                </div>
                                <Button variant="destructive" icon={TrashIcon} onClick={() => setBulkDeleteTargets(selectedConfigs)}>
                                    {t('Delete records', { count: selectedConfigs.length })}
                                </Button>
                            </div>
                        )}
                        {configs.loading && !configs.data ? (
                            <ListSkeleton label={t('Loading configuration…')} />
                        ) : data.items.length ? (
                            <div className="overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:text-base [&_th]:border-b [&_th]:border-kumo-line [&_th]:bg-kumo-tint [&_th]:px-5 [&_th]:py-3 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-kumo-line [&_td]:px-5 [&_td]:py-3.5 [&_tr:last-child_td]:border-b-0 [&_tbody_tr:hover]:bg-kumo-tint/40">
                                <table>
                                    <thead>
                                        <tr>
                                            <th className="w-12 pr-0!">
                                                <Checkbox
                                                    aria-label={t('Select all configuration')}
                                                    checked={allSelected}
                                                    indeterminate={selectedConfigs.length > 0 && !allSelected}
                                                    disabled={configs.loading}
                                                    onCheckedChange={(checked) =>
                                                        setSelectedKeys(new Set(checked ? data.items.map((config) => config.key) : []))
                                                    }
                                                />
                                            </th>
                                            <th>{t('Configuration key')}</th>
                                            <th>{t('Type')}</th>
                                            <th>{t('Description')}</th>
                                            <th>{t('Last updated')}</th>
                                            <th>{t('Version')}</th>
                                            <th className="text-right">{t('Action')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.items.map((config) => (
                                            <tr
                                                key={config.key}
                                                data-selected={selectedKeys.has(config.key)}
                                                className="data-[selected=true]:bg-kumo-tint/60"
                                            >
                                                <td className="pr-0!">
                                                    <Checkbox
                                                        aria-label={t('Select {{key}}', { key: config.key })}
                                                        checked={selectedKeys.has(config.key)}
                                                        disabled={configs.loading}
                                                        onCheckedChange={(checked) =>
                                                            setSelectedKeys((current) => {
                                                                const next = new Set(current);

                                                                if (checked) {
                                                                    next.add(config.key);
                                                                } else {
                                                                    next.delete(config.key);
                                                                }

                                                                return next;
                                                            })
                                                        }
                                                    />
                                                </td>
                                                <td>
                                                    <CopyButton value={config.key} label={config.key} inline />
                                                </td>
                                                <td>
                                                    <span
                                                        data-type={config.type}
                                                        className="inline-block rounded px-2 py-0.5 whitespace-nowrap text-slate-600 bg-slate-100 data-[type=yaml]:bg-amber-50 data-[type=yaml]:text-amber-800 data-[type=json]:bg-violet-50 data-[type=json]:text-violet-700 data-[type=boolean]:bg-emerald-50 data-[type=boolean]:text-emerald-700 data-[type=number]:bg-blue-50 data-[type=number]:text-blue-700"
                                                    >
                                                        {typeLabels[config.type]}
                                                    </span>
                                                </td>
                                                <td className="max-w-56 truncate text-kumo-subtle">{config.description || '—'}</td>
                                                <td className="text-kumo-subtle whitespace-nowrap">{date(config.updated_at)}</td>
                                                <td className="font-mono text-[0.9em] text-kumo-subtle">v{config.revision}</td>
                                                <td>
                                                    <div className="flex items-center gap-2 justify-end">
                                                        <Button
                                                            variant="ghost"
                                                            shape="square"
                                                            aria-label={t('Edit {{value1}}', { value1: config.key })}
                                                            icon={PencilSimpleIcon}
                                                            onClick={() => void edit(config)}
                                                        />
                                                        <a
                                                            className="inline-flex size-8 items-center justify-center rounded text-kumo-subtle hover:bg-kumo-tint"
                                                            aria-label={t('Download {{value1}}', { value1: config.key })}
                                                            href={`/api/v1${base}/configurations/${encodeURIComponent(config.key)}/raw?download=1`}
                                                        >
                                                            <DownloadSimpleIcon size={18} />
                                                        </a>
                                                        <Button
                                                            variant="ghost"
                                                            shape="square"
                                                            icon={ClockCounterClockwiseIcon}
                                                            aria-label={t('History for {{key}}', { key: config.key })}
                                                            onClick={() => {
                                                                setError('');
                                                                setHistoryKey(config.key);
                                                            }}
                                                        />
                                                        <Button
                                                            variant="ghost"
                                                            shape="square"
                                                            aria-label={t('Delete {{value1}}', { value1: config.key })}
                                                            icon={TrashIcon}
                                                            onClick={() => setDeleting(config)}
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <Empty
                                title={search ? t('No matching configuration') : t('Create your first configuration')}
                                description={
                                    search
                                        ? t('Try another key or clear your search.')
                                        : t('Add a simple value or save a complete configuration file.')
                                }
                                action={
                                    !search && (
                                        <Button
                                            icon={PlusIcon}
                                            onClick={() => {
                                                setDraft({ ...emptyDraft });
                                                setEditorOpen(true);
                                            }}
                                        >
                                            {t('Create configuration')}
                                        </Button>
                                    )
                                }
                            />
                        )}
                        <div className="border-t border-kumo-line px-5 py-4 text-kumo-subtle">{t('Item count', { count: data.total })}</div>
                    </div>
                </section>
            )}
            {tab === 'history' && <HistoryList base={base} revision={revision} onInspect={(item) => void inspectHistory(item)} />}
            <Modal
                open={historyKey !== null}
                onClose={() => setHistoryKey(null)}
                title={t('History for {{key}}', { key: historyKey ?? '' })}
                wide
            >
                <ErrorMessage error={error} />
                <HistoryList
                    key={historyKey ?? ''}
                    base={base}
                    configKey={historyKey ?? undefined}
                    revision={revision}
                    onInspect={(item) => void inspectHistory(item)}
                />
            </Modal>
            <Modal
                open={editorOpen}
                onClose={() => {
                    if (!saving) {
                        setEditorOpen(false);
                    }
                }}
                title={draft.revision === undefined ? t('Create configuration') : t('Edit configuration')}
                description={t('Changes take effect immediately and notify connected clients.')}
                wide
            >
                <form onSubmit={save}>
                    <div className="grid items-start gap-4 sm:grid-cols-2">
                        <Input
                            label={t('Configuration key')}
                            value={draft.key}
                            readOnly={draft.revision !== undefined}
                            placeholder={t('e.g. application.yml or feature.enabled')}
                            required
                            pattern={IDENTIFIER_PATTERN.source}
                            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                        />
                        <Select
                            label={t('Content type')}
                            value={draft.type}
                            items={typeLabels}
                            onValueChange={(value) => {
                                if (value) {
                                    setDraft({
                                        ...draft,
                                        type: value as ConfigType,
                                        value: value === 'boolean' && !['true', 'false'].includes(draft.value) ? 'false' : draft.value,
                                    });
                                }
                            }}
                        >
                            {Object.entries(typeLabels).map(([value, label]) => (
                                <Select.Option key={value} value={value}>
                                    {label}
                                </Select.Option>
                            ))}
                        </Select>
                    </div>
                    <Input
                        label={t('Description')}
                        value={draft.description}
                        maxLength={500}
                        placeholder={t('What is this configuration for? (optional)')}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                    <span className="-mb-3 font-medium">{t('Value')}</span>
                    {draft.type === 'boolean' ? (
                        <Select
                            aria-label={t('Boolean value')}
                            value={draft.value}
                            items={{ true: 'true', false: 'false' }}
                            onValueChange={(value) => {
                                if (value) {
                                    setDraft({ ...draft, value });
                                }
                            }}
                        >
                            <Select.Option value="true">true</Select.Option>
                            <Select.Option value="false">false</Select.Option>
                        </Select>
                    ) : (
                        <div className="overflow-hidden rounded-lg ring ring-kumo-line">
                            <div className="flex justify-between border-b border-kumo-line bg-kumo-tint px-3.5 py-2 text-kumo-subtle">
                                <span>{typeLabels[draft.type]}</span>
                                <span>UTF-8</span>
                            </div>
                            <ConfigEditor
                                type={draft.type}
                                label={t('Value')}
                                value={draft.value}
                                onChange={(value) => setDraft((current) => ({ ...current, value }))}
                                placeholder={draft.type === 'yaml' ? 'server:\n  port: 8080' : t('Enter a value…')}
                            />
                        </div>
                    )}
                    <ErrorMessage error={editorError} />
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2.5 border-t border-kumo-line pt-5 [&>.text-kumo-subtle:first-child]:mr-auto">
                        <span className="text-kumo-subtle">{new TextEncoder().encode(draft.value).length.toLocaleString()} bytes</span>
                        <Button disabled={saving} onClick={() => setEditorOpen(false)} type="button">
                            {t('Cancel')}
                        </Button>
                        <Button variant="primary" loading={saving} type="submit">
                            {t('Save configuration')}
                        </Button>
                    </div>
                </form>
            </Modal>
            <ConfirmDialog
                open={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                title={t('Delete configuration')}
                description={t('Delete {{value1}}? Connected clients will be notified. You can restore its content from history.', {
                    value1: deleting?.key ?? '',
                })}
                onConfirm={async () => {
                    if (deleting) {
                        await api(`${base}/configurations/${encodeURIComponent(deleting.key)}`, {
                            method: 'DELETE',
                            headers: revisionHeaders(deleting.revision),
                        });
                        refresh();
                    }
                }}
            />
            <BulkDeleteDialog
                base={base}
                configs={bulkDeleteTargets}
                onClose={() => setBulkDeleteTargets([])}
                onDeleted={(keys) => {
                    setSelectedKeys((current) => {
                        const next = new Set(current);

                        for (const key of keys) {
                            next.delete(key);
                        }

                        return next;
                    });
                    refresh();
                }}
            />
            <Modal
                open={Boolean(selectedHistory)}
                onClose={() => {
                    if (!saving) {
                        setSelectedHistory(null);
                    }
                }}
                title={`${selectedHistory?.key ?? t('Configuration')} · v${selectedHistory?.revision ?? ''}`}
                description={
                    selectedHistory
                        ? `${t(actionLabels[selectedHistory.action])} · ${selectedHistory.actor} · ${date(selectedHistory.created_at)}`
                        : ''
                }
                wide
            >
                <p className="text-kumo-subtle">
                    {selectedHistory?.action === 'delete'
                        ? t('This is the content before deletion. Restore it as a new version.')
                        : t('Restoring creates a new version and notifies connected clients.')}
                </p>
                <div className="my-4 overflow-hidden rounded-lg ring ring-kumo-line">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-kumo-line bg-kumo-tint px-4 py-3 text-base">
                        <span>
                            {previousHistory && previousHistory.action !== 'delete' ? `v${previousHistory.revision}` : t('Not present')} → v
                            {selectedHistory?.revision}
                        </span>
                        <span className="flex gap-4">
                            <span className="text-red-700">− {t('Removed')}</span>
                            <span className="text-emerald-700">+ {t('Added')}</span>
                        </span>
                    </div>
                    {selectedHistory && <ConfigDiff before={before} after={after} type={selectedHistory.type} label={t('Version diff')} />}
                </div>
                {before === after && (
                    <p className="mb-4 text-kumo-subtle">{t('No content changes. Check the type and description below.')}</p>
                )}
                <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
                    <dt className="text-kumo-subtle">{t('Type')}</dt>
                    <dd>
                        {previousHistory && previousHistory.action !== 'delete' ? typeLabels[previousHistory.type] : '—'} →{' '}
                        {selectedHistory?.action === 'delete' ? '—' : selectedHistory && typeLabels[selectedHistory.type]}
                    </dd>
                    <dt className="text-kumo-subtle">{t('Description')}</dt>
                    <dd className="wrap-anywhere">
                        {previousHistory && previousHistory.action !== 'delete' ? previousHistory.description || '—' : '—'} →{' '}
                        {selectedHistory?.action === 'delete' ? '—' : selectedHistory?.description || '—'}
                    </dd>
                </dl>
                <ErrorMessage error={editorError} />
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2.5 border-t border-kumo-line pt-5 [&>.text-kumo-subtle:first-child]:mr-auto">
                    <Button onClick={() => setSelectedHistory(null)}>{t('Close')}</Button>
                    <Button
                        variant="primary"
                        icon={ArrowCounterClockwiseIcon}
                        loading={saving}
                        onClick={async () => {
                            if (!selectedHistory) {
                                return;
                            }

                            setSaving(true);
                            setEditorError('');

                            try {
                                await api(
                                    `${base}/configurations/${encodeURIComponent(selectedHistory.key)}/history/${selectedHistory.id}/restore`,
                                    {
                                        method: 'POST',
                                        headers: revisionHeaders(restoreRevision),
                                    },
                                );
                                setSelectedHistory(null);
                                refresh();
                            } catch (e) {
                                setEditorError(message(e));
                            } finally {
                                setSaving(false);
                            }
                        }}
                    >
                        {t('Restore this version')}
                    </Button>
                </div>
            </Modal>
        </>
    );
}
