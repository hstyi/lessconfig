import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Combobox } from '@cloudflare/kumo/components/combobox';
import { Button, LinkButton } from '@cloudflare/kumo/components/button';
import { CaretUpDownIcon, ArrowRightIcon } from '@phosphor-icons/react';
import type { Environment, Project } from '../lib/api.ts';

/** Use immutable environment identifiers and project display names consistently. */
function resourceLabel(item: Project | Environment) {
    return 'name' in item ? item.name : item.slug;
}

/** Supplement each label with its project slug or optional environment remarks. */
function resourceDetail(item: Project | Environment) {
    return 'name' in item ? item.slug : item.description;
}

type ResourceSwitcherProps = { loading: boolean } & (
    | { kind: 'project'; items: Project[]; current?: Project }
    | { kind: 'environment'; project: Project; items: Environment[]; current?: Environment }
);

/** Switch projects on overview pages or environments within the selected project. */
export function ResourceSwitcher(props: ResourceSwitcherProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const { items, current, loading } = props;
    const isEnvironment = props.kind === 'environment';
    const base = isEnvironment ? `/projects/${props.project.slug}/environments` : '/projects';
    const allHref = isEnvironment ? `/projects/${props.project.slug}` : '/projects';

    return (
        <Combobox<Project | Environment>
            items={items}
            value={current ?? null}
            itemToStringLabel={(item) => `${resourceLabel(item)} ${resourceDetail(item)}`.trim()}
            isItemEqualToValue={(item, selected) => item.id === selected.id}
            open={open}
            onOpenChange={setOpen}
            onValueChange={(item) => {
                if (item) {
                    navigate(`${base}/${item.slug}`);
                }

                setOpen(false);
            }}
        >
            <Combobox.Trigger
                render={
                    <Button
                        variant="ghost"
                        aria-label={t(isEnvironment ? 'Switch environment' : 'Switch project')}
                        disabled={loading}
                        className="min-w-0 max-w-60 gap-2 md:max-w-96"
                    />
                }
            >
                <span className="truncate">{current ? resourceLabel(current) : t(isEnvironment ? 'Environments' : 'Projects')}</span>
                {current && !isEnvironment && (
                    <span className="hidden max-w-28 shrink-0 truncate rounded-full px-2 font-mono text-[0.9em] text-kumo-subtle ring ring-kumo-line sm:block">
                        {current.slug}
                    </span>
                )}
                <CaretUpDownIcon size={14} className="shrink-0 text-kumo-subtle" />
            </Combobox.Trigger>
            <Combobox.Content align="start" sideOffset={8} className="w-96 max-w-[calc(100vw-2rem)] p-0">
                <div className="border-b border-kumo-line p-3">
                    <Combobox.Input
                        aria-label={t(isEnvironment ? 'Search environments' : 'Search projects')}
                        placeholder={t(isEnvironment ? 'Search environments…' : 'Search projects…')}
                        className="mt-0 rounded-md first:mb-0"
                    />
                </div>
                <Combobox.List className="max-h-72 overflow-y-auto p-2 empty:hidden">
                    {(item: Project | Environment) => (
                        <Combobox.Item key={item.id} value={item} aria-label={`${resourceLabel(item)} ${resourceDetail(item)}`.trim()}>
                            <span className="flex min-w-0 items-center gap-3">
                                <span className="min-w-0 flex-1 truncate">{resourceLabel(item)}</span>
                                {resourceDetail(item) && (
                                    <span
                                        className={
                                            isEnvironment
                                                ? 'max-w-48 truncate text-kumo-subtle'
                                                : 'max-w-40 shrink-0 truncate rounded-full px-2 font-mono text-[0.9em] text-kumo-subtle ring ring-kumo-line'
                                        }
                                    >
                                        {resourceDetail(item)}
                                    </span>
                                )}
                            </span>
                        </Combobox.Item>
                    )}
                </Combobox.List>
                <Combobox.Empty>
                    <span className="flex min-h-20 items-center justify-center text-center text-base leading-5">
                        {t(isEnvironment ? 'No matching environments' : 'No matching projects')}
                    </span>
                </Combobox.Empty>
                <div className="flex items-center justify-between gap-3 border-t border-kumo-line px-3 py-3 text-kumo-subtle">
                    <span>{t(isEnvironment ? 'Environment count' : 'Project count', { count: items.length })}</span>
                    <LinkButton href={allHref} variant="ghost" size="sm" onClick={() => setOpen(false)} className="gap-2 text-sm">
                        {t(isEnvironment ? 'View all environments' : 'View all projects')}
                        <ArrowRightIcon size={14} />
                    </LinkButton>
                </div>
            </Combobox.Content>
        </Combobox>
    );
}
