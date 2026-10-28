import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PhosphorIcon } from '@phosphor-icons/core';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@cloudflare/kumo/components/button';
import { useTranslation } from 'react-i18next';
import { ProjectIcon } from './ProjectIcon';
import { projectIconLabel } from '../lib/projectIconLabel.ts';

const columns = 6;
const rowHeight = 44;

/** Render visible icon rows and retain keyboard focus when its row leaves the viewport. */
export function ProjectIconGrid({
    items,
    value,
    onChange,
}: {
    items: readonly PhosphorIcon[];
    value: PhosphorIcon['name'];
    onChange: (icon: PhosphorIcon['name']) => void;
}) {
    'use no memo'; // TanStack Virtual exposes a mutable instance; automatic memoization would make it stale.

    const { t } = useTranslation();
    const scroll = useRef<HTMLDivElement>(null);
    const buttons = useRef(new Map<number, HTMLButtonElement>());
    const focusRequested = useRef(false);

    const [activeIndex, setActiveIndex] = useState(() =>
        Math.max(
            0,
            items.findIndex((icon) => icon.name === value),
        ),
    );

    const rowCount = Math.ceil(items.length / columns);

    // oxlint-disable-next-line react/incompatible-library -- This component explicitly opts out of automatic memoization.
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scroll.current,
        estimateSize: () => rowHeight,
        overscan: 2,
        initialOffset: () => Math.floor(activeIndex / columns) * rowHeight,
        rangeExtractor: (range) =>
            [...new Set([...defaultRangeExtractor(range), Math.floor(activeIndex / columns)])]
                .filter((index) => index < rowCount)
                .sort((a, b) => a - b),
    });

    useLayoutEffect(() => {
        if (focusRequested.current) {
            buttons.current.get(activeIndex)?.focus({ preventScroll: true });
            focusRequested.current = false;
        }
    }, [activeIndex]);

    /** Move through the complete catalog, including rows that have not been mounted yet. */
    function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        let next = index;

        switch (event.key) {
            case 'ArrowRight':
                next++;

                break;

            case 'ArrowLeft':
                next--;

                break;

            case 'ArrowDown':
                next += columns;

                break;

            case 'ArrowUp':
                next -= columns;

                break;

            case 'Home':
                next = 0;

                break;

            case 'End':
                next = items.length - 1;

                break;

            default:
                return;
        }

        event.preventDefault();
        next = Math.max(0, Math.min(items.length - 1, next));
        focusRequested.current = true;
        virtualizer.scrollToIndex(Math.floor(next / columns), { align: 'auto' });

        if (next === activeIndex) {
            buttons.current.get(next)?.focus({ preventScroll: true });
            focusRequested.current = false;
        } else {
            setActiveIndex(next);
        }
    }

    return (
        <div
            ref={scroll}
            role="grid"
            aria-label={t('Available icons')}
            aria-rowcount={rowCount}
            aria-colcount={columns}
            data-testid="project-icon-grid"
            className="mt-3 h-64 overflow-y-auto overscroll-contain p-1"
        >
            {items.length ? (
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((row) => (
                        <div
                            key={row.key}
                            role="row"
                            aria-rowindex={row.index + 1}
                            className="absolute top-0 left-0 grid w-full grid-cols-6 gap-1"
                            style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                        >
                            {items.slice(row.index * columns, (row.index + 1) * columns).map((icon, column) => {
                                const index = row.index * columns + column;
                                const label = t(projectIconLabel(icon.name));

                                return (
                                    <div key={icon.name} role="gridcell" aria-colindex={column + 1}>
                                        <Button
                                            ref={(element) => {
                                                if (element) {
                                                    buttons.current.set(index, element);
                                                } else {
                                                    buttons.current.delete(index);
                                                }
                                            }}
                                            type="button"
                                            variant="ghost"
                                            shape="square"
                                            aria-label={label}
                                            title={`${label} · ${icon.name}`}
                                            aria-pressed={value === icon.name}
                                            tabIndex={activeIndex === index ? 0 : -1}
                                            className="size-10 aria-pressed:bg-kumo-tint aria-pressed:text-kumo-link aria-pressed:ring aria-pressed:ring-kumo-brand"
                                            onFocus={() => setActiveIndex(index)}
                                            onKeyDown={(event) => navigate(event, index)}
                                            onClick={() => onChange(icon.name)}
                                        >
                                            <ProjectIcon name={icon.name} size={22} />
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="grid h-full place-items-center text-kumo-subtle">{t('No matching icons')}</p>
            )}
        </div>
    );
}
