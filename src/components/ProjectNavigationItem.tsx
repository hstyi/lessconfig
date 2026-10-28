import { useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Sidebar } from '@cloudflare/kumo/components/sidebar';
import { ProjectIcon } from './ProjectIcon';
import type { Project } from '../lib/api.ts';
import { useProjectResources } from '../hooks/useProjectResources';

/** Expand the current project's section while keeping manual expansion independent per project. */
export function ProjectNavigationItem({ project }: { project: Project }) {
    const { t } = useTranslation();
    const params = useParams();
    const active = params.project === project.slug;
    const [open, setOpen] = useState(active);
    const { environments, loading, error } = useProjectResources(project, open);
    const [wasActive, setWasActive] = useState(active);

    // Reveal a project when entering it through a deep link or another page.
    if (active !== wasActive) {
        setWasActive(active);

        if (active) {
            setOpen(true);
        }
    }

    return (
        <Sidebar.MenuItem>
            <Sidebar.Collapsible open={open} onOpenChange={setOpen}>
                <Sidebar.CollapsibleTrigger
                    render={
                        <Sidebar.MenuButton
                            icon={<ProjectIcon name={project.icon} className="block size-4 shrink-0 self-center opacity-40" />}
                            className="transition-none data-[active=true]:bg-kumo-tint data-[active=true]:text-kumo-default"
                        >
                            <span className="flex h-5 min-w-0 flex-1 items-center gap-2 leading-5">
                                <span className="min-w-0 truncate">{project.name}</span>
                                <Sidebar.MenuChevron className="self-center" />
                            </span>
                        </Sidebar.MenuButton>
                    }
                />
                <Sidebar.CollapsibleContent>
                    <Sidebar.MenuSub>
                        <Sidebar.MenuSubButton
                            href={`/projects/${project.slug}`}
                            active={active && !params.environment}
                            className="transition-none"
                        >
                            {t('Project overview')}
                        </Sidebar.MenuSubButton>
                        {loading ? (
                            <div className="px-3 py-2 text-kumo-subtle">{t('Loading environments…')}</div>
                        ) : (
                            environments.map((environment) => (
                                <Sidebar.MenuSubButton
                                    key={environment.id}
                                    href={`/projects/${project.slug}/environments/${environment.slug}`}
                                    active={active && params.environment === environment.slug}
                                    className="transition-none"
                                >
                                    {environment.slug}
                                </Sidebar.MenuSubButton>
                            ))
                        )}
                        {error && (
                            <div role="alert" className="px-3 py-2 text-kumo-danger">
                                {error}
                            </div>
                        )}
                    </Sidebar.MenuSub>
                </Sidebar.CollapsibleContent>
            </Sidebar.Collapsible>
        </Sidebar.MenuItem>
    );
}
