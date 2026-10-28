import { ListSkeleton } from '../components/ListSkeleton';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@cloudflare/kumo/components/button';
import { PlusIcon, ArrowUpRightIcon, FolderSimpleIcon, StackIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useWorkspace } from '../hooks/useWorkspace';
import { Empty } from '../components/Empty';
import { EntityDialog } from '../components/EntityDialog';
import { ProjectIcon } from '../components/ProjectIcon';
import { DefaultPasswordNotice } from '../components/DefaultPasswordNotice';
import { useWorkspaceStore } from '../stores/workspace';

/** List projects and create a new project through the public API. */
export function ProjectsView() {
    const { t } = useTranslation();
    const { projects, loadingProjects, refresh, setProjects, user } = useWorkspace();
    const environmentLists = useWorkspaceStore((state) => state.environmentLists);
    const loadEnvironments = useWorkspaceStore((state) => state.loadEnvironments);
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    useEffect(() => {
        for (const project of projects) {
            void loadEnvironments(project);
        }
    }, [projects, loadEnvironments]);

    if (loadingProjects) {
        return <ListSkeleton label={t('Loading projects…')} />;
    }

    const countsReady = projects.every((project) => {
        const list = environmentLists[project.id];

        return list?.loaded && !list.error;
    });
    const environmentCount = countsReady ? projects.reduce((sum, project) => sum + environmentLists[project.id].items.length, 0) : null;

    return (
        <>
            <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold leading-tight md:text-[28px]">{t('Projects')}</h1>
                    <p className="mt-2 text-kumo-subtle">{t('Organize configuration by project and environment.')}</p>
                </div>
                <Button variant="primary" icon={PlusIcon} onClick={() => setSearchParams({ create: 'project' })}>
                    {t('Create project')}
                </Button>
            </header>
            {user.role === 'admin' && user.defaultPassword && (
                <div className="mb-6">
                    <DefaultPasswordNotice />
                </div>
            )}
            <div className="flex flex-wrap items-center gap-6 rounded-md bg-kumo-base px-5 py-6 ring ring-kumo-line lg:gap-12 lg:px-7 [&>div]:flex [&>div]:items-center [&>div]:gap-3 [&>div]:text-kumo-subtle [&_strong]:ml-3 [&_strong]:text-2xl [&_strong]:font-semibold [&_strong]:text-kumo-default">
                <div>
                    <FolderSimpleIcon size={21} />
                    <span>{t('Project')}</span>
                    <strong>{projects.length}</strong>
                </div>
                <div>
                    <StackIcon size={21} />
                    <span>{t('Environment')}</span>
                    <strong>{environmentCount ?? '—'}</strong>
                </div>
            </div>
            <div className="flex items-center gap-3 [&_p]:mt-1 [&_p]:text-kumo-subtle mt-7 mb-4 justify-between">
                <h2 className="text-lg font-semibold">{t('All projects')}</h2>
                <span className="text-kumo-subtle">{t('Project count', { count: projects.length })}</span>
            </div>
            {projects.length ? (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
                    {projects.map((p) => (
                        <Link
                            className="flex min-w-0 flex-col rounded-md bg-kumo-base px-5 pt-5 text-left ring ring-kumo-line hover:ring-kumo-brand"
                            key={p.id}
                            to={`/projects/${p.slug}`}
                        >
                            <div className="flex items-start gap-3">
                                <span className="grid h-7 shrink-0 place-items-center text-kumo-subtle">
                                    <ProjectIcon name={p.icon} size={24} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <h3 className="text-lg font-semibold wrap-anywhere">{p.name}</h3>
                                    <span className="font-mono text-[0.9em] wrap-anywhere text-kumo-subtle">{p.slug}</span>
                                </div>
                                <ArrowUpRightIcon size={18} className="mt-1 shrink-0 text-kumo-subtle" />
                            </div>
                            <div className="flex-1 pb-5">
                                {p.description && <p className="mt-3 wrap-anywhere text-kumo-subtle">{p.description}</p>}
                            </div>
                            <div className="flex items-center justify-between gap-2 border-t border-kumo-line py-4 text-kumo-subtle">
                                <span className="flex items-center gap-1.5">
                                    <StackIcon size={16} />
                                    {environmentLists[p.id]?.loading || !environmentLists[p.id]?.loaded
                                        ? t('Loading environments…')
                                        : environmentLists[p.id].error
                                          ? t('Unable to load environments')
                                          : t('Environment count', { count: environmentLists[p.id].items.length })}
                                </span>
                                <CaretRightIcon size={14} />
                            </div>
                        </Link>
                    ))}
                </div>
            ) : (
                <section className="overflow-hidden rounded-md bg-kumo-base ring ring-kumo-line">
                    <Empty
                        title={t('Create your first project')}
                        description={t('Create a project, add an environment, and save your first configuration.')}
                    />
                </section>
            )}

            <EntityDialog
                open={searchParams.get('create') === 'project'}
                kind="project"
                onClose={() => setSearchParams({}, { replace: true })}
                onSaved={(result) => {
                    if (!('name' in result)) {
                        return;
                    }

                    setProjects((current) => [...current, result]);
                    refresh();
                    navigate(`/projects/${result.slug}`);
                }}
            />
        </>
    );
}
