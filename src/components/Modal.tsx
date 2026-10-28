import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Dialog } from '@cloudflare/kumo/components/dialog';
import { XIcon } from '@phosphor-icons/react';

/** Keep the dialog mounted so Kumo can manage focus and open/close transitions. */
export function Modal({
    open,
    onClose,
    title,
    description,
    children,
    wide = false,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children: ReactNode;
    wide?: boolean;
}) {
    const { t } = useTranslation();

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(value) => {
                if (!value) {
                    onClose();
                }
            }}
        >
            <Dialog
                size={wide ? 'xl' : 'lg'}
                className="max-h-[calc(100dvh-3rem)] overflow-y-auto p-5 sm:p-6 [&_form]:flex [&_form]:flex-col [&_form]:gap-5"
            >
                <div className="mb-6 flex items-start justify-between gap-3 [&_h2]:mb-1.5 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:text-kumo-subtle">
                    <div>
                        <Dialog.Title>{title}</Dialog.Title>
                        {description && <Dialog.Description>{description}</Dialog.Description>}
                    </div>
                    <Button variant="ghost" shape="square" aria-label={t('Close')} icon={XIcon} onClick={onClose} />
                </div>
                {children}
            </Dialog>
        </Dialog.Root>
    );
}
