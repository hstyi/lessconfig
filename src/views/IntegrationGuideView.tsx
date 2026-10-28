import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@cloudflare/kumo/components/select';
import { useWorkspace } from '../hooks/useWorkspace';
import { useProjectResources } from '../hooks/useProjectResources';
import { CopyButton } from '../components/CopyButton';
import { ErrorMessage } from '../components/ErrorMessage';

/** Explain client access with examples scoped to a selectable project and environment. */
export function IntegrationGuideView() {
    const { t } = useTranslation();
    const { projects } = useWorkspace();
    const [projectId, setProjectId] = useState('');
    const [environmentId, setEnvironmentId] = useState('');
    const project = projects.find((item) => item.id === projectId) ?? projects[0];
    const { environments, loading, error } = useProjectResources(project);
    const environment = environments.find((item) => item.id === environmentId) ?? environments[0];
    const base = `/projects/${project?.slug ?? '<PROJECT>'}/environments/${environment?.slug ?? '<ENVIRONMENT>'}`;
    const endpoint = `${window.location.origin}/api/v1${base}`;
    const scope = `${project?.slug ?? '<PROJECT>'}/${environment?.slug ?? '<ENVIRONMENT>'}`;
    const query = new URLSearchParams({ scopes: scope });
    const initialCurl = `curl '${window.location.origin}/api/v1/watch?${query}' \\\n  -H 'Authorization: Bearer <API_TOKEN>'`;
    const curl = `curl '${endpoint}/configurations' \\\n  -H 'Authorization: Bearer <API_TOKEN>'`;
    const watchCurl = `curl '${window.location.origin}/api/v1/watch?${query}&revision=<REVISION>&timeout=60' \\\n  -H 'Authorization: Bearer <API_TOKEN>' \\\n  --max-time 90`;

    return (
        <>
            <header className="mb-6">
                <h1 className="text-2xl font-semibold md:text-[28px]">{t('Integration Guide')}</h1>
                <p className="mt-2 text-kumo-subtle">{t('Connect your application to configuration and watch for updates.')}</p>
            </header>
            <div className="mb-6 grid w-full gap-5 sm:grid-cols-2 [&_[role=combobox]]:w-full">
                <Select
                    label={t('Project')}
                    className="w-full min-w-0 justify-between"
                    value={project?.id ?? null}
                    placeholder={t('Select a project')}
                    items={projects.map((item) => ({ value: item.id, label: item.name }))}
                    onValueChange={(value) => {
                        setProjectId(value ?? '');
                        setEnvironmentId('');
                    }}
                >
                    {projects.map((item) => (
                        <Select.Option key={item.id} value={item.id}>
                            {item.name}
                        </Select.Option>
                    ))}
                </Select>
                <Select
                    label={t('Environment')}
                    className="w-full min-w-0 justify-between"
                    value={environment?.id ?? null}
                    disabled={loading || !environments.length}
                    placeholder={t('Select an environment')}
                    items={environments.map((item) => ({ value: item.id, label: item.slug }))}
                    onValueChange={(value) => setEnvironmentId(value ?? '')}
                >
                    {environments.map((item) => (
                        <Select.Option key={item.id} value={item.id}>
                            {item.slug}
                        </Select.Option>
                    ))}
                </Select>
            </div>
            <ErrorMessage error={error} />
            <div className="grid gap-5 xl:grid-cols-3">
                <section className="overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line min-w-0 p-6 [&_h3]:mt-3.5 [&_h3]:mb-2 [&_h3]:text-lg [&_p]:leading-7 [&_p]:text-kumo-subtle">
                    <span className="rounded bg-blue-50 px-2 py-1 font-medium text-blue-700">01</span>
                    <h3 className="text-base font-semibold">{t('Initialize watch')}</h3>
                    <p>
                        {t(
                            'Create an API token with Read access to this environment. Call watch without revision to receive the current revision immediately, before reading configuration.',
                        )}
                    </p>
                    <div className="mt-5 rounded bg-kumo-tint p-4 ring ring-kumo-line [&_pre]:mb-3 [&_pre]:font-mono [&_pre]:leading-7 [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere [&_pre]:text-kumo-subtle">
                        <pre>{initialCurl}</pre>
                        <CopyButton value={initialCurl} />
                    </div>
                </section>
                <section className="overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line min-w-0 p-6 [&_h3]:mt-3.5 [&_h3]:mb-2 [&_h3]:text-lg [&_p]:leading-7 [&_p]:text-kumo-subtle">
                    <span className="rounded bg-blue-50 px-2 py-1 font-medium text-blue-700">02</span>
                    <h3 className="text-base font-semibold">{t('Read configuration')}</h3>
                    <p>
                        {t(
                            "Read and apply this environment's configuration after initializing watch. Keep the revision returned by watch.",
                        )}
                    </p>
                    <div className="mt-5 rounded bg-kumo-tint p-4 ring ring-kumo-line [&_pre]:mb-3 [&_pre]:font-mono [&_pre]:leading-7 [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere [&_pre]:text-kumo-subtle">
                        <pre>{curl}</pre>
                        <CopyButton value={curl} />
                    </div>
                    <p className="text-kumo-subtle">
                        {t('For the original file, use')} <code className="font-mono text-[0.9em]">/configurations/your-file-name/raw</code>
                        .
                    </p>
                </section>
                <section className="overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line min-w-0 p-6 [&_h3]:mt-3.5 [&_h3]:mb-2 [&_h3]:text-lg [&_p]:leading-7 [&_p]:text-kumo-subtle">
                    <span className="rounded bg-blue-50 px-2 py-1 font-medium text-blue-700">03</span>
                    <h3 className="text-base font-semibold">{t('Watch for changes')}</h3>
                    <p>
                        {t(
                            'Pass the saved watch revision with the same scopes. The GET request returns on a matching change, or after 60 seconds.',
                        )}
                    </p>
                    <div className="mt-5 rounded bg-kumo-tint p-4 ring ring-kumo-line [&_pre]:mb-3 [&_pre]:font-mono [&_pre]:leading-7 [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere [&_pre]:text-kumo-subtle">
                        <pre>{watchCurl}</pre>
                        <CopyButton value={watchCurl} />
                    </div>
                    <p className="text-kumo-subtle">
                        {t(
                            'After changes, reload and apply configuration before saving the revision from that watch response. Retry failed reads without advancing. If the revision expires, initialize watch again before reloading.',
                        )}
                    </p>
                </section>
                <section className="overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line min-w-0 p-6 [&_h3]:mt-3.5 [&_h3]:mb-2 [&_h3]:text-lg [&_p]:leading-7 [&_p]:text-kumo-subtle col-span-full [&_h3]:mt-0">
                    <h3 className="text-base font-semibold">{t('Environment endpoint')}</h3>
                    <div className="mt-5 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center [&_code]:wrap-anywhere">
                        <code className="font-mono text-[0.9em]">{endpoint}</code>
                        <CopyButton value={endpoint} label={t('Copy endpoint')} />
                    </div>
                    <p className="text-kumo-subtle">
                        {t('Send the current version in If-Match when editing. Use If-None-Match: * when creating.')}
                    </p>
                </section>
            </div>
        </>
    );
}
