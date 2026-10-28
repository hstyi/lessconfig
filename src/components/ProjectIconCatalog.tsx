import type { IconProps } from '@phosphor-icons/react';
import { FolderSimpleIcon } from '@phosphor-icons/react/dist/csr/FolderSimple';
import { lazyProjectIcons } from '../lib/loadProjectIcon.ts';

/** Resolve persisted names after the catalog has been loaded on demand. */
export function ProjectIconCatalog({ name, ...props }: IconProps & { name: string }) {
    const pascalName = name
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

    const Icon = Object.hasOwn(lazyProjectIcons, pascalName) ? lazyProjectIcons[pascalName] : FolderSimpleIcon;

    return <Icon {...props} />;
}
