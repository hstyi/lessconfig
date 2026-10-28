import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { icons, type PhosphorIcon } from '@phosphor-icons/core';
import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { Popover } from '@cloudflare/kumo/components/popover';
import { CaretDownIcon } from '@phosphor-icons/react';
import { ProjectIcon } from './ProjectIcon';
import { ProjectIconGrid } from './ProjectIconGrid';
import { projectIconLabel } from '../lib/projectIconLabel.ts';

/** Search the official catalog instead of maintaining a separate list of project icons. */
export function ProjectIconPicker({ value, onChange }: { value: PhosphorIcon['name']; onChange: (icon: PhosphorIcon['name']) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

        return icons.filter((icon) => {
            const searchable = [icon.name, icon.pascal_name, t(projectIconLabel(icon.name)), ...icon.categories, ...icon.tags]
                .join(' ')
                .toLocaleLowerCase();

            return words.every((word) => searchable.includes(word));
        });
    }, [query, t]);

    return (
        <div className="flex flex-col items-start gap-2">
            <span className="font-medium">{t('Icon')}</span>
            <Popover.Root
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    setQuery('');
                }}
            >
                <Popover.Trigger render={<Button type="button" aria-label={t('Project icon')} title={t(projectIconLabel(value))} />}>
                    <ProjectIcon name={value} size={20} />
                    <CaretDownIcon size={14} className="text-kumo-subtle" />
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Positioner side="bottom" align="start" className="z-100">
                        <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] p-3" data-testid="project-icon-picker">
                            <Popover.Title className="mb-3 font-medium">{t('Choose an icon')}</Popover.Title>
                            <Input
                                aria-label={t('Search icons')}
                                placeholder={t('Search icons…')}
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                            <ProjectIconGrid
                                key={query}
                                items={filtered}
                                value={value}
                                onChange={(name) => {
                                    onChange(name);
                                    setOpen(false);
                                    setQuery('');
                                }}
                            />
                            <p className="mt-3 border-t border-kumo-line pt-3 text-kumo-subtle" aria-live="polite">
                                {t('Icon results', { count: filtered.length, total: icons.length })}
                            </p>
                        </Popover.Popup>
                    </Popover.Positioner>
                </Popover.Portal>
            </Popover.Root>
        </div>
    );
}
