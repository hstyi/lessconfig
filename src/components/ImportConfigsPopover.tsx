import { useRef, useState } from 'react';
import { isPlainObject, isString } from 'lodash-es';
import { isIdentifier } from '../../shared/identifiers';
import { useTranslation } from 'react-i18next';
import { Button } from '@cloudflare/kumo/components/button';
import { Popover } from '@cloudflare/kumo/components/popover';
import { useKumoToastManager } from '@cloudflare/kumo/components/toast';
import { UploadSimpleIcon } from '@phosphor-icons/react';
import { api, message, revisionHeaders, type Config, type ConfigType, type ListResponse } from '../lib/api.ts';

type ImportedConfig = Pick<Config, 'key' | 'value' | 'type' | 'description'>;

const configTypes: ConfigType[] = ['text', 'boolean', 'number', 'json', 'yaml', 'properties'];

/** Parse the exported format before making any changes to the target environment. */
function parseConfigs(text: string): ImportedConfig[] {
    const items: unknown = JSON.parse(text);
    if (!Array.isArray(items)) {
        throw new Error('The file must contain a JSON array of configuration entries.');
    }

    const keys = new Set<string>();
    return items.map((item: unknown) => {
        if (!isPlainObject(item)) {
            throw new Error('Each entry must have a key, value, type, and description.');
        }
        const { key, value, type, description } = item as Record<string, unknown>;
        if (
            !isIdentifier(key) ||
            !isString(value) ||
            !isString(type) ||
            !configTypes.includes(type as ConfigType) ||
            !isString(description)
        ) {
            throw new Error('Each entry must have a valid key, value, type, and description.');
        }
        if (keys.has(key)) {
            throw new Error('The file contains duplicate configuration keys.');
        }
        keys.add(key);
        return { key, value, type: type as ConfigType, description };
    });
}

/** Import each entry with its current revision, reporting partial failures without hiding successful writes. */
export function ImportConfigsPopover({ base, onImported }: { base: string; onImported: () => void }) {
    const { t } = useTranslation();
    const toast = useKumoToastManager();
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<ImportedConfig[] | null>(null);
    const [error, setError] = useState('');
    const [failures, setFailures] = useState<Map<string, string>>(new Map());
    const [completed, setCompleted] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [fileName, setFileName] = useState('');
    const [dragging, setDragging] = useState(false);
    const fileSelection = useRef(0);

    function resetAndClose() {
        fileSelection.current++;
        setItems(null);
        setError('');
        setFailures(new Map());
        setCompleted(null);
        setFileName('');
        setDragging(false);
        setOpen(false);
    }

    async function selectFile(file: File | undefined) {
        const selection = ++fileSelection.current;
        setItems(null);
        setError('');
        setFailures(new Map());
        setCompleted(null);
        setFileName(file?.name ?? '');
        if (!file) {
            return;
        }
        try {
            const parsed = parseConfigs(await file.text());
            if (fileSelection.current === selection) {
                setItems(parsed);
            }
        } catch (error) {
            if (fileSelection.current === selection) {
                setError(error instanceof SyntaxError ? 'The file is not valid JSON.' : message(error));
            }
        }
    }

    async function importConfigs() {
        if (!items?.length) {
            return;
        }
        setBusy(true);
        setError('');
        setFailures(new Map());
        setCompleted(null);
        const failed = new Map<string, string>();
        let imported = 0;
        try {
            const current = await api<ListResponse<Config>>(`${base}/configurations`);
            const revisions = new Map(current.items.map((config) => [config.key, config.revision]));
            for (const item of items) {
                try {
                    await api(`${base}/configurations/${encodeURIComponent(item.key)}`, {
                        method: 'PUT',
                        headers: revisionHeaders(revisions.get(item.key)),
                        body: JSON.stringify({ value: item.value, type: item.type, description: item.description }),
                    });
                    imported++;
                } catch (error) {
                    failed.set(item.key, message(error));
                }
            }
            setCompleted(imported);
            setFailures(failed);
            setItems(items.filter((item) => failed.has(item.key)));
            if (imported) {
                onImported();
            }
            if (!failed.size) {
                resetAndClose();
                toast.add({ title: t('Imported configuration entries', { count: imported }), variant: 'success' });
            }
        } catch (error) {
            setError(message(error));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) {
                    setOpen(true);
                } else if (!busy) {
                    resetAndClose();
                }
            }}
        >
            <Popover.Trigger render={<Button variant="secondary" icon={UploadSimpleIcon} />}>{t('Import')}</Popover.Trigger>
            <Popover.Content align="start" className="w-[min(22rem,calc(100vw-2rem))] p-4">
                <Popover.Title>{t('Import configuration')}</Popover.Title>
                <Popover.Description className="mt-2">{t('Choose a JSON export. Existing keys will be overwritten.')}</Popover.Description>
                <label
                    data-dragging={dragging}
                    className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-kumo-line p-3 text-center data-[dragging=true]:bg-kumo-tint has-[:focus-visible]:outline has-[:focus-visible]:outline-kumo-link"
                    onDragOver={(event) => {
                        event.preventDefault();
                        if (!busy) {
                            setDragging(true);
                        }
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        if (!busy) {
                            void selectFile(event.dataTransfer.files[0]);
                        }
                    }}
                >
                    <input
                        className="sr-only"
                        type="file"
                        aria-label={t('JSON file')}
                        accept=".json,application/json"
                        disabled={busy}
                        onChange={(event) => {
                            void selectFile(event.target.files?.[0]);
                            event.target.value = '';
                        }}
                    />
                    <UploadSimpleIcon size={22} className="text-kumo-subtle" aria-hidden="true" />
                    <span>
                        <span className="text-kumo-link underline">{t('Choose file')}</span> {t('or drag and drop it here')}
                    </span>
                    {fileName && <span className="max-w-full truncate text-kumo-subtle">{fileName}</span>}
                </label>
                {items && completed === null && (
                    <p className="mt-4 text-kumo-subtle">{t('Configuration entries ready', { count: items.length })}</p>
                )}
                {completed !== null && (
                    <p role="status" className="mt-4">
                        {t('Imported configuration entries', { count: completed })}
                    </p>
                )}
                {error && (
                    <p role="alert" className="mt-4 text-red-700">
                        {t(error)}
                    </p>
                )}
                {failures.size > 0 && (
                    <div role="alert" className="mt-4 text-red-700">
                        <p>{t('Some configuration entries could not be imported. Retry or choose another file.')}</p>
                        <ul className="mt-2 max-h-40 overflow-y-auto">
                            {[...failures].map(([key, reason]) => (
                                <li key={key} className="wrap-anywhere">
                                    {key}: {t(reason)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="mt-4 flex justify-end">
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={busy || !items?.length}
                        loading={busy}
                        onClick={() => void importConfigs()}
                    >
                        {t(failures.size ? 'Retry failed entries' : 'Import')}
                    </Button>
                </div>
            </Popover.Content>
        </Popover>
    );
}
