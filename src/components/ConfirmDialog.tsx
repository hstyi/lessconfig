import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Modal } from './Modal';
import { ErrorMessage } from './ErrorMessage';
import { message } from '../lib/api.ts';

/** Require an explicit action before destructive operations and keep failures visible. */
export function ConfirmDialog({
    title,
    description,
    open,
    onClose,
    onConfirm,
}: {
    title: string;
    description: string;
    open: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    /** Clear the previous API failure before the dialog is opened again. */
    function close() {
        if (!busy) {
            setError('');
            onClose();
        }
    }

    return (
        <Modal open={open} onClose={close} title={title} description={description}>
            <ErrorMessage error={error} />
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2.5 border-t border-kumo-line pt-5 [&>.text-kumo-subtle:first-child]:mr-auto">
                <Button disabled={busy} onClick={close}>
                    {t('Cancel')}
                </Button>
                <Button
                    variant="destructive"
                    loading={busy}
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        setError('');

                        try {
                            await onConfirm();
                            onClose();
                        } catch (e) {
                            setError(message(e));
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    {t('Confirm')}
                </Button>
            </div>
        </Modal>
    );
}
