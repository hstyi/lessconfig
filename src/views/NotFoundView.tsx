import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Empty } from '../components/Empty';

/** Show a recoverable page for unknown browser URLs. */
export function NotFoundView() {
    const { t } = useTranslation();

    return (
        <Empty
            title={t('Page not found')}
            description={t('This page does not exist. Return to your projects.')}
            action={
                <Link className="text-kumo-link hover:underline" to="/projects">
                    {t('Projects')}
                </Link>
            }
        />
    );
}
