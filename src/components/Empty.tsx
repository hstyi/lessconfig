import type { ReactNode } from 'react';
import { FolderSimpleIcon } from '@phosphor-icons/react';

/** Render an empty collection with its next available action. */
export function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
    return (
        <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-5 py-10 text-center [&_h3]:text-lg [&_p]:mb-2 [&_p]:max-w-md [&_p]:text-kumo-subtle">
            <span className="mb-1 grid size-16 place-items-center rounded-2xl bg-kumo-tint text-kumo-subtle">
                <FolderSimpleIcon size={28} />
            </span>
            <h3 className="text-base font-semibold">{title}</h3>
            <p>{description}</p>
            {action}
        </div>
    );
}
