import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@cloudflare/kumo/components/button';
import { ArrowRightIcon, PlusIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { api, type Config, type Environment, type ListResponse } from '../lib/api.ts';
import { useProject } from '../hooks/useProject';
import { useWorkspace } from '../hooks/useWorkspace';
import { EntityDialog } from '../components/EntityDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Empty } from '../components/Empty';
import { ErrorMessage } from '../components/ErrorMessage';
import { ListSkeleton } from '../components/ListSkeleton';

/** Read the configuration count from the environment's existing configuration list. */
function EnvironmentConfigCount({ projectSlug, environment }: { projectSlug: string; environment: Environment }) {
    const { t } = useTranslation();
    const [result, setResult] = useState<{ revision: number; count: number | null } | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        void api<ListResponse<Config>>(`/projects/${projectSlug}/environments/${environment.slug}/configurations`, {
            signal: controller.signal,
        })
            .then(({ total }) => {
                if (!controller.signal.aborted) {
                    setResult({ revision: environment.revision, count: total });
                }
            })
            .catch(() => {
                if (!controller.signal.aborted) {
                    setResult({ revision: environment.revision, count: null });
                }
            });

        return () => controller.abort();
    }, [projectSlug, environment.slug, environment.revision]);

    if (!result || result.revision !== environment.revision) {
        return <span aria-label={t('Loading configuration count…')}>—</span>;
    }

    return result.count === null ? t('Unable to load configuration count') : t('Item count', { count: result.count });
}

/** Show a project's environment list without redirecting to an arbitrary environment. */
export function ProjectOverviewView() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { project, environments, setEnvironments, loading, error, refresh } = useProject();
    const { setProjects } = useWorkspace();
    const [dialog, setDialog] = useState<'project' | 'environment' | null>(null);
    const [deleting, setDeleting] = useState(false);

    return (
        <>
            <header className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div className="w-full min-w-0 md:w-auto md:flex-1">
                    <div className="text-kumo-subtle">
                        {t('Project overview')} <span className="font-mono text-[0.9em]">/ {project.slug}</span>
                    </div>
                    <h1 className="mt-1 mb-2 text-2xl font-semibold leading-tight md:text-[28px]">{project.name}</h1>
                    <p className="text-kumo-subtle">{project.description || t('Manage the environments in this project.')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        shape="square"
                        icon={PencilSimpleIcon}
                        aria-label={t('Edit project')}
                        onClick={() => setDialog('project')}
                    />
                    <Button
                        variant="ghost"
                        shape="square"
                        icon={TrashIcon}
                        aria-label={t('Delete project')}
                        onClick={() => setDeleting(true)}
                    />
                    <Button variant="primary" icon={PlusIcon} onClick={() => setDialog('environment')}>
                        {t('Create environment')}
                    </Button>
                </div>
            </header>
            <ErrorMessage error={error} />
            <section
                aria-label={t('Environments')}
                aria-busy={loading}
                className="overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line"
            >
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                    <h2 className="text-base font-semibold">{t('Environments')}</h2>
                    {!loading && <span className="text-kumo-subtle">{t('Environment count', { count: environments.length })}</span>}
                </div>
                {loading ? (
                    <ListSkeleton label={t('Loading environments…')} />
                ) : environments.length ? (
                    <div className="overflow-x-auto [&_table]:w-full [&_th]:border-y [&_th]:border-kumo-line [&_th]:bg-kumo-tint [&_th]:px-5 [&_th]:py-3 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-kumo-line [&_td]:px-5 [&_td]:py-4 [&_tr:last-child_td]:border-b-0 [&_tbody_tr:hover]:bg-kumo-tint/40">
                        <table>
                            <thead>
                                <tr>
                                    <th>{t('Identifier')}</th>
                                    <th>{t('Remarks')}</th>
                                    <th>{t('Configuration')}</th>
                                    <th>{t('Version')}</th>
                                    <th>
                                        <span className="sr-only">{t('Action')}</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {environments.map((environment) => (
                                    <tr key={environment.id}>
                                        <td>
                                            <Link
                                                to={`/projects/${project.slug}/environments/${environment.slug}`}
                                                className="font-medium text-kumo-link hover:underline"
                                            >
                                                {environment.slug}
                                            </Link>
                                        </td>
                                        <td className="max-w-80 wrap-anywhere text-kumo-subtle">{environment.description || '—'}</td>
                                        <td className="text-kumo-subtle">
                                            <EnvironmentConfigCount projectSlug={project.slug} environment={environment} />
                                        </td>
                                        <td className="font-mono text-[0.9em] text-kumo-subtle">v{environment.revision}</td>
                                        <td>
                                            <Link
                                                to={`/projects/${project.slug}/environments/${environment.slug}`}
                                                aria-label={t('Open {{name}}', { name: environment.slug })}
                                                className="flex justify-end text-kumo-subtle hover:text-kumo-link"
                                            >
                                                <ArrowRightIcon size={18} />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : !error ? (
                    <Empty
                        title={t('Create your first environment')}
                        description={t('Separate configuration and access with development, testing, and production environments.')}
                        action={
                            <Button icon={PlusIcon} onClick={() => setDialog('environment')}>
                                {t('Create environment')}
                            </Button>
                        }
                    />
                ) : (
                    <div className="px-5 pb-5">
                        <Button onClick={refresh}>{t('Retry')}</Button>
                    </div>
                )}
            </section>
            <EntityDialog
                open={Boolean(dialog)}
                kind={dialog ?? 'environment'}
                project={project}
                current={dialog === 'project' ? project : undefined}
                onClose={() => setDialog(null)}
                onSaved={(result) => {
                    if ('project_id' in result) {
                        setEnvironments((current) => [...current, result]);
                        navigate(`/projects/${project.slug}/environments/${result.slug}`);
                    } else {
                        setProjects((current) => current.map((item) => (item.id === result.id ? { ...item, ...result } : item)));
                    }

                    refresh();
                }}
            />
            <ConfirmDialog
                open={deleting}
                onClose={() => setDeleting(false)}
                title={t('Delete project')}
                description={t('Delete “{{value1}}”? Related access grants will be removed.', {
                    value1: project.name,
                })}
                onConfirm={async () => {
                    await api(`/projects/${project.slug}`, { method: 'DELETE' });
                    setProjects((current) => current.filter((item) => item.id !== project.id));
                    navigate('/projects');
                    refresh();
                }}
            />
        </>
    );
}
