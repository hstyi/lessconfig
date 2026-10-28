import { Link, Outlet, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useWorkspace } from '../hooks/useWorkspace';
import { PageFrame } from '../components/PageFrame';
import { Empty } from '../components/Empty';
import { ListSkeleton } from '../components/ListSkeleton';

/** Resolve the project before exposing the shell resources to nested project views. */
export function ProjectLayout() {
    const { t } = useTranslation();
    const { loadingProjects, projects } = useWorkspace();
    const { project: slug } = useParams();
    const project = projects.find((item) => item.slug === slug);

    return (
        <PageFrame>
            {loadingProjects ? (
                <ListSkeleton label={t('Loading projects…')} />
            ) : !project ? (
                <Empty
                    title={t('Project not found')}
                    description={t('This project may have been deleted. Return to your projects.')}
                    action={
                        <Link to="/projects" className="text-kumo-link">
                            {t('Projects')}
                        </Link>
                    }
                />
            ) : (
                <Outlet key={project.id} />
            )}
        </PageFrame>
    );
}
