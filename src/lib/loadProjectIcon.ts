import { lazy } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
    ArrowRightIcon,
    ArrowSquareOutIcon,
    ArrowUpRightIcon,
    ArrowsDownUpIcon,
    BookOpenIcon,
    CaretRightIcon,
    GearSixIcon,
    GithubLogoIcon,
    HeartIcon,
    HouseIcon,
    KeyIcon,
    PlusIcon,
    SlidersHorizontalIcon,
    StackIcon,
    TranslateIcon,
    UserIcon,
    XIcon,
} from '@phosphor-icons/react';
import { FolderSimpleIcon } from '@phosphor-icons/react/dist/csr/FolderSimple';

// Vite discovers installed components and emits lazy chunks; SVG code loads only when rendered.
const loaders = import.meta.glob<Record<string, Icon>>([
    '/node_modules/@phosphor-icons/react/dist/csr/*.es.js',
    '!/node_modules/@phosphor-icons/react/dist/csr/{ArrowRight,ArrowSquareOut,ArrowUpRight,ArrowsDownUp,BookOpen,CaretRight,FolderSimple,GearSix,GithubLogo,Heart,House,Key,Plus,SlidersHorizontal,Stack,Translate,User,X}.es.js',
]);

// Keep this list and the glob exclusion in sync: these icons are already used statically.
const sharedIcons: Record<string, Icon> = {
    ArrowRight: ArrowRightIcon,
    ArrowSquareOut: ArrowSquareOutIcon,
    ArrowUpRight: ArrowUpRightIcon,
    ArrowsDownUp: ArrowsDownUpIcon,
    BookOpen: BookOpenIcon,
    CaretRight: CaretRightIcon,
    FolderSimple: FolderSimpleIcon,
    GearSix: GearSixIcon,
    GithubLogo: GithubLogoIcon,
    Heart: HeartIcon,
    House: HouseIcon,
    Key: KeyIcon,
    Plus: PlusIcon,
    SlidersHorizontal: SlidersHorizontalIcon,
    Stack: StackIcon,
    Translate: TranslateIcon,
    User: UserIcon,
    X: XIcon,
};

export const lazyProjectIcons: Record<string, Icon> = {
    ...sharedIcons,
    ...Object.fromEntries(
        Object.entries(loaders).map(([path, load]) => {
            const pascalName = path.slice(path.lastIndexOf('/') + 1, -'.es.js'.length);

            return [
                pascalName,
                lazy(() =>
                    load()
                        .then((module) => ({ default: module[`${pascalName}Icon`] ?? FolderSimpleIcon }))
                        // Decorative icons must not make the entire dashboard fail after a network error.
                        .catch(() => ({ default: FolderSimpleIcon })),
                ),
            ];
        }),
    ),
};
