import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { WarningCircleIcon } from '@phosphor-icons/react';

/** Show the initial-password reminder on the project overview with a link to account settings. */
export function DefaultPasswordNotice() {
    const { t } = useTranslation();

    return (
        <div
            className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-base leading-5 text-amber-800 ring ring-amber-200"
            role="status"
        >
            <WarningCircleIcon size={18} className="shrink-0" aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{t('The administrator is still using the initial password.')}</span>
                <Link to="/settings" className="font-medium underline underline-offset-2 hover:text-amber-950">
                    {t('Change password')}
                </Link>
            </div>
        </div>
    );
}
