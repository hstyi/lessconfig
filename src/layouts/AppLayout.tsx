import { Link, Outlet, useLocation, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Sidebar } from '@cloudflare/kumo/components/sidebar';
import { SlidersHorizontalIcon } from '@phosphor-icons/react';
import { AccountMenu } from '../components/AccountMenu';
import { ReleaseUpdate } from '../components/ReleaseUpdate';
import { WorkspaceSidebar } from '../components/WorkspaceSidebar';
import { ResourceSwitcher } from '../components/ResourceSwitcher';
import { useWorkspace } from '../hooks/useWorkspace';
import { useProjectResources } from '../hooks/useProjectResources';

/** Keep route-aware resource switching in the global titlebar beside the account controls. */
export function AppLayout() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const { project: projectSlug, environment: environmentSlug } = useParams();
    const { projects, loadingProjects } = useWorkspace();
    const project = projects.find((item) => item.slug === projectSlug);
    const resources = useProjectResources(project);
    const current = resources.environments.find((item) => item.slug === environmentSlug);
    const hasProjectSwitcher = Boolean(projectSlug) || pathname === '/projects';

    return (
        <Sidebar.Provider contained peekable className="h-dvh bg-kumo-canvas [--sidebar-bg:var(--color-kumo-canvas)]" defaultWidth={248}>
            <WorkspaceSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
                <header
                    aria-label={t('Titlebar')}
                    className="flex h-15 shrink-0 items-center justify-between gap-x-3 border-b border-kumo-line bg-kumo-canvas px-4 md:px-6"
                >
                    <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-5">
                        <Sidebar.Trigger className="shrink-0 md:hidden" aria-label={t('Open navigation')} />
                        <Link
                            to="/projects"
                            aria-label="lessconfig"
                            className="grid size-8 shrink-0 place-items-center rounded-md bg-orange-500 text-white md:hidden"
                        >
                            <SlidersHorizontalIcon size={22} />
                        </Link>
                        {hasProjectSwitcher && (
                            <div className="flex min-w-0 items-center">
                                {environmentSlug && project ? (
                                    <ResourceSwitcher
                                        key={`environment:${project.id}`}
                                        kind="environment"
                                        project={project}
                                        items={resources.environments}
                                        current={current}
                                        loading={resources.loading}
                                    />
                                ) : (
                                    <ResourceSwitcher
                                        key="project"
                                        kind="project"
                                        items={projects}
                                        current={project}
                                        loading={loadingProjects}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <ReleaseUpdate />
                        <AccountMenu />
                    </div>
                </header>
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                    <Outlet />
                </div>
            </div>
        </Sidebar.Provider>
    );
}
