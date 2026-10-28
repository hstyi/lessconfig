import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@cloudflare/kumo/components/button';
import { useKumoToastManager } from '@cloudflare/kumo/components/toast';
import { DownloadSimpleIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { message } from '../lib/api.ts';
import { exportWorkspace, importWorkspace, parseWorkspace, type ImportResult, type WorkspaceTransfer } from '../lib/workspaceTransfer';
import { useWorkspaceStore } from '../stores/workspace';

/** Transfer projects, environments, and configurations through the existing resource APIs. */
export function ImportExportView() {
    const { t } = useTranslation();
    const toast = useKumoToastManager();
    const [file, setFile] = useState<WorkspaceTransfer | null>(null);
    const [fileName, setFileName] = useState('');
    const [importError, setImportError] = useState('');
    const [exportError, setExportError] = useState('');
    const [result, setResult] = useState<ImportResult | null>(null);
    const [working, setWorking] = useState<'import' | 'export' | null>(null);
    const [progress, setProgress] = useState('');
    const [dragging, setDragging] = useState(false);
    const selection = useRef(0);

    async function selectFile(chosen: File | undefined) {
        const current = ++selection.current;
        setFile(null);
        setFileName(chosen?.name ?? '');
        setImportError('');
        setResult(null);
        if (!chosen) {
            return;
        }
        try {
            const parsed = parseWorkspace(await chosen.text());
            if (selection.current === current) {
                setFile(parsed);
            }
        } catch (error) {
            if (selection.current === current) {
                setImportError(error instanceof SyntaxError ? 'The file is not valid JSON.' : message(error));
            }
        }
    }

    async function exportAll() {
        setWorking('export');
        setExportError('');
        setProgress('');
        try {
            const data = await exportWorkspace(setProgress);
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'lessconfig-export.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            setExportError(message(error));
        } finally {
            setWorking(null);
            setProgress('');
        }
    }

    async function importAll() {
        if (!file) {
            return;
        }
        setWorking('import');
        setResult(null);
        setImportError('');
        setProgress('');
        try {
            const imported = await importWorkspace(file, setProgress);
            setResult(imported);
            if (!imported.failures.length) {
                setFile(null);
                setFileName('');
                toast.add({ title: t('Workspace import complete.'), variant: 'success' });
            }
        } catch (error) {
            setImportError(message(error));
        } finally {
            // Refresh the sidebar, including environment lists that were already loaded.
            const workspace = useWorkspaceStore.getState();
            await workspace.loadProjects();
            const updated = useWorkspaceStore.getState();
            await Promise.all(
                updated.projects
                    .filter((project) => updated.environmentLists[project.id]?.loaded)
                    .map((project) => updated.loadEnvironments(project, true)),
            );
            setWorking(null);
            setProgress('');
        }
    }

    return (
        <>
            <header className="mb-6">
                <h1 className="text-2xl font-semibold md:text-[28px]">{t('Import / Export')}</h1>
                <p className="mt-2 text-kumo-subtle">{t('Transfer projects, environments, and configuration using a JSON file.')}</p>
            </header>
            <div className="grid gap-5 lg:grid-cols-2">
                <section aria-labelledby="workspace-import-title" className="rounded-md bg-kumo-base p-5 ring ring-kumo-line">
                    <div className="flex items-center gap-2">
                        <UploadSimpleIcon size={20} className="text-kumo-subtle" aria-hidden="true" />
                        <h2 id="workspace-import-title" className="text-lg font-semibold">
                            {t('Import workspace')}
                        </h2>
                    </div>
                    <p className="mt-2 text-kumo-subtle">
                        {t('Existing projects, environments, and configurations will be updated. Other data will be kept.')}
                    </p>
                    <label
                        data-dragging={dragging}
                        className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-kumo-line p-3 text-center data-[dragging=true]:bg-kumo-tint has-[:focus-visible]:outline has-[:focus-visible]:outline-kumo-link"
                        onDragOver={(event) => {
                            event.preventDefault();
                            if (!working) {
                                setDragging(true);
                            }
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragging(false);
                            if (!working) {
                                void selectFile(event.dataTransfer.files[0]);
                            }
                        }}
                    >
                        <input
                            type="file"
                            className="sr-only"
                            aria-label={t('JSON file')}
                            accept=".json,application/json"
                            disabled={Boolean(working)}
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
                    {file && !result && (
                        <p className="mt-3 text-kumo-subtle">
                            {t('Workspace file ready', {
                                projects: file.projects.length,
                                environments: file.projects.reduce((n, project) => n + project.environments.length, 0),
                                configs: file.projects.reduce(
                                    (n, project) => n + project.environments.reduce((m, environment) => m + environment.configs.length, 0),
                                    0,
                                ),
                            })}
                        </p>
                    )}
                    {importError && (
                        <p role="alert" className="mt-3 text-red-700">
                            {t(importError)}
                        </p>
                    )}
                    {result && (
                        <div className="mt-3" role="status">
                            <p>
                                {t('Workspace import result', {
                                    projects: result.projects,
                                    environments: result.environments,
                                    configs: result.configs,
                                })}
                            </p>
                            {result.failures.length > 0 && (
                                <div className="mt-2 text-red-700">
                                    <p>{t('Some items failed. Successful changes were kept.')}</p>
                                    <ul className="mt-2 max-h-48 overflow-y-auto">
                                        {result.failures.map((failure, index) => (
                                            <li key={`${failure.path}-${index}`} className="wrap-anywhere">
                                                {failure.path}: {t(failure.reason)}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                    {working === 'import' && (
                        <p role="status" className="mt-3 text-kumo-subtle">
                            {t('Importing workspace…')} {progress}
                        </p>
                    )}
                    <div className="mt-4 flex justify-end">
                        <Button
                            variant="primary"
                            icon={UploadSimpleIcon}
                            loading={working === 'import'}
                            disabled={!file || Boolean(working)}
                            onClick={() => void importAll()}
                        >
                            {t('Import')}
                        </Button>
                    </div>
                </section>
                <section aria-labelledby="workspace-export-title" className="rounded-md bg-kumo-base p-5 ring ring-kumo-line self-start">
                    <div className="flex items-center gap-2">
                        <DownloadSimpleIcon size={20} className="text-kumo-subtle" aria-hidden="true" />
                        <h2 id="workspace-export-title" className="text-lg font-semibold">
                            {t('Export workspace')}
                        </h2>
                    </div>
                    <p className="mt-2 text-kumo-subtle">{t('Download all projects, environments, and configurations as a JSON file.')}</p>
                    <p className="mt-2 text-kumo-subtle">{t('Passwords, API tokens, and history are not included.')}</p>
                    {exportError && (
                        <p role="alert" className="mt-3 text-red-700">
                            {t(exportError)}
                        </p>
                    )}
                    {working === 'export' && (
                        <p role="status" className="mt-3 text-kumo-subtle">
                            {t('Exporting workspace…')} {progress}
                        </p>
                    )}
                    <div className="mt-4 flex justify-end">
                        <Button
                            variant="primary"
                            icon={DownloadSimpleIcon}
                            loading={working === 'export'}
                            disabled={Boolean(working)}
                            onClick={() => void exportAll()}
                        >
                            {t('Export')}
                        </Button>
                    </div>
                </section>
            </div>
        </>
    );
}
