import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Sidebar, useSidebar } from '@cloudflare/kumo/components/sidebar';
import { Button } from '@cloudflare/kumo/components/button';
import {
    HouseIcon,
    ArrowsDownUpIcon,
    BookOpenIcon,
    KeyIcon,
    GearSixIcon,
    SlidersHorizontalIcon,
    XIcon,
    GithubLogoIcon,
    HeartIcon,
    ArrowSquareOutIcon,
} from '@phosphor-icons/react';
import { useWorkspace } from '../hooks/useWorkspace';
import { ProjectNavigationItem } from './ProjectNavigationItem';

/** Use Kumo's responsive sidebar and route-aware links for workspace navigation. */
export function WorkspaceSidebar() {
    const { t } = useTranslation();
    const { projects, loadingProjects } = useWorkspace();
    const location = useLocation();
    const { isMobile, setOpenMobile } = useSidebar();

    useEffect(() => {
        setOpenMobile(false);
    }, [location.key, setOpenMobile]);

    return (
        <Sidebar role="navigation" aria-label={t('Main navigation')} className="shrink-0" contentClassName="bg-kumo-canvas">
            <Sidebar.Header className="h-15 shrink-0 flex-row items-center justify-between border-b border-kumo-line px-3">
                <Link to="/projects" aria-label="lessconfig" className="flex min-w-0 items-center gap-3 text-xl font-semibold">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-orange-500 text-white">
                        <SlidersHorizontalIcon size={22} />
                    </span>
                    <span data-testid="brand-title" className="truncate group-data-[state=collapsed]/sidebar:hidden">
                        lessconfig<span className="text-orange-500">.</span>
                    </span>
                </Link>
                {isMobile && (
                    <Button
                        variant="ghost"
                        shape="square"
                        icon={XIcon}
                        aria-label={t('Close navigation')}
                        onClick={() => setOpenMobile(false)}
                    />
                )}
            </Sidebar.Header>
            <Sidebar.Content>
                <div>
                    <Sidebar.Group>
                        <Sidebar.Menu>
                            <Sidebar.MenuButton
                                href="/projects"
                                icon={HouseIcon}
                                active={location.pathname === '/projects'}
                                className="transition-none data-[active=true]:bg-kumo-tint data-[active=true]:text-kumo-default"
                            >
                                {t('Home')}
                            </Sidebar.MenuButton>
                        </Sidebar.Menu>
                    </Sidebar.Group>
                    {(loadingProjects || projects.length > 0) && (
                        <Sidebar.Group>
                            <Sidebar.GroupLabel>{t('Projects')}</Sidebar.GroupLabel>
                            {loadingProjects ? (
                                <Sidebar.Loading label={t('Loading projects…')} />
                            ) : (
                                <Sidebar.Menu>
                                    {projects.map((item) => (
                                        <ProjectNavigationItem key={item.id} project={item} />
                                    ))}
                                </Sidebar.Menu>
                            )}
                        </Sidebar.Group>
                    )}
                    <Sidebar.Group>
                        <Sidebar.GroupLabel>{t('Settings')}</Sidebar.GroupLabel>
                        <Sidebar.Menu>
                            <Sidebar.MenuButton
                                href="/api-keys"
                                icon={KeyIcon}
                                active={location.pathname.startsWith('/api-keys')}
                                className="transition-none data-[active=true]:bg-kumo-tint data-[active=true]:text-kumo-default"
                            >
                                {t('API Tokens')}
                            </Sidebar.MenuButton>
                            <Sidebar.MenuButton
                                href="/settings"
                                icon={GearSixIcon}
                                active={location.pathname === '/settings'}
                                className="transition-none data-[active=true]:bg-kumo-tint data-[active=true]:text-kumo-default"
                            >
                                {t('Account Settings')}
                            </Sidebar.MenuButton>
                            <Sidebar.MenuButton
                                href="/import-export"
                                icon={ArrowsDownUpIcon}
                                active={location.pathname === '/import-export'}
                                className="transition-none data-[active=true]:bg-kumo-tint data-[active=true]:text-kumo-default"
                            >
                                {t('Import / Export')}
                            </Sidebar.MenuButton>
                        </Sidebar.Menu>
                    </Sidebar.Group>
                    <Sidebar.Separator />
                    <Sidebar.Group>
                        <Sidebar.Menu>
                            <Sidebar.MenuButton
                                href="/integration"
                                icon={BookOpenIcon}
                                active={location.pathname === '/integration'}
                                className="transition-none data-[active=true]:bg-kumo-tint data-[active=true]:text-kumo-default"
                            >
                                {t('Integration Guide')}
                            </Sidebar.MenuButton>
                            <Sidebar.MenuButton
                                href="https://github.com/lessconfig/lessconfig"
                                target="_blank"
                                rel="noopener noreferrer"
                                icon={GithubLogoIcon}
                                tooltip={t('GitHub')}
                                className="transition-none"
                            >
                                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                    {t('GitHub')}
                                    <ArrowSquareOutIcon size={14} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
                                </span>
                            </Sidebar.MenuButton>
                            <Sidebar.MenuButton
                                href="https://buymeacoffee.com/hstyi"
                                target="_blank"
                                rel="noopener noreferrer"
                                icon={HeartIcon}
                                tooltip={t('Sponsor')}
                                className="transition-none"
                            >
                                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                    {t('Sponsor')}
                                    <ArrowSquareOutIcon size={14} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
                                </span>
                            </Sidebar.MenuButton>
                        </Sidebar.Menu>
                    </Sidebar.Group>
                </div>
            </Sidebar.Content>
            {!isMobile && (
                <Sidebar.Footer className="border-t border-kumo-line">
                    <Sidebar.Trigger aria-label={t('Toggle navigation')} />
                </Sidebar.Footer>
            )}
        </Sidebar>
    );
}
