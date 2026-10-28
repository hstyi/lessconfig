import { Suspense, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspace } from '../hooks/useWorkspace';
import { ErrorMessage } from './ErrorMessage';
import { ListSkeleton } from './ListSkeleton';

/** Share content spacing beneath the global application titlebar. */
export function PageFrame({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const { error } = useWorkspace();

    return (
        <main className="mx-auto flex min-h-full w-full max-w-[1660px] flex-col px-4 pt-6 pb-6 md:px-8 md:pt-7">
            <ErrorMessage error={error} />
            <Suspense fallback={<ListSkeleton label={t('Loading page…')} />}>{children}</Suspense>
        </main>
    );
}
