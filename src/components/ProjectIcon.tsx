import { lazy, Suspense } from 'react';
import type { IconProps } from '@phosphor-icons/react';
import { FolderSimpleIcon } from '@phosphor-icons/react/dist/csr/FolderSimple';

const ProjectIconCatalog = lazy(() =>
    import('./ProjectIconCatalog')
        .then((module) => ({ default: module.ProjectIconCatalog }))
        .catch(() => ({
            default: ({ name: _name, ...props }: IconProps & { name: string }) => <FolderSimpleIcon {...props} />,
        })),
);

/** Render persisted project icons with a safe folder fallback for unknown identifiers. */
export function ProjectIcon({ name = 'folder-simple', size = 16, ...props }: IconProps & { name?: string }) {
    return (
        <Suspense fallback={<svg aria-hidden="true" width={size} height={size} className={props.className} />}>
            {name === 'folder-simple' ? (
                <FolderSimpleIcon aria-hidden="true" data-project-icon={name} size={size} {...props} />
            ) : (
                <ProjectIconCatalog name={name} aria-hidden="true" data-project-icon={name} size={size} {...props} />
            )}
        </Suspense>
    );
}
