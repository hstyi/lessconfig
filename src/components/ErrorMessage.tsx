import { useTranslation } from 'react-i18next';
import { WarningCircleIcon } from '@phosphor-icons/react';

/** Display a localized UI message or the original English API error. */
export function ErrorMessage({ error }: { error?: string }) {
    const { t } = useTranslation();

    return error ? (
        <div
            className="my-3 flex items-center gap-2 rounded bg-red-50 px-3.5 py-3 text-base leading-5 text-red-700 ring ring-red-200"
            role="alert"
        >
            <WarningCircleIcon size={18} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 wrap-anywhere">{t(error)}</span>
        </div>
    ) : null;
}
