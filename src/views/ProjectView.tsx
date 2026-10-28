import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@cloudflare/kumo/components/button';
import { PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { api } from '../lib/api.ts';
import { useProject } from '../hooks/useProject';
import { EnvironmentView } from './EnvironmentView';
import { EntityDialog } from '../components/EntityDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Empty } from '../components/Empty';
import { ErrorMessage } from '../components/ErrorMessage';
import { ListSkeleton } from '../components/ListSkeleton';

/** Resolve the selected environment while the parent route owns project navigation. */
export function ProjectView() {
    const { t } = useTranslation();
    const { environment: environmentSlug } = useParams();
    const navigate = useNavigate();
    const { project, environments, setEnvironments, loading, error, refresh } = useProject();
    const environment = environments.find((item) => item.slug === environmentSlug);
    const [editing, setEditing] = useState(false);
    const [deleting, setDeleting] = useState(false);

    if (loading) {
        return <ListSkeleton label={t('Loading environments…')} />;
    }

    if (!environment) {
        return (
            <>
                <ErrorMessage error={error} />
                <Empty
                    title={t('Environment not found')}
                    description={t('Select another environment or return to the project overview.')}
                    action={
                        <Link to={`/projects/${project.slug}`} className="text-kumo-link">
                            {t('Project overview')}
                        </Link>
                    }
                />
            </>
        );
    }

    return (
        <>
            <header className="mb-6 flex items-start justify-between gap-4 md:items-center">
                <div className="min-w-0">
                    <div className="text-kumo-subtle">
                        {project.name} <span className="font-mono text-[0.9em]">/ {environment.slug}</span>
                    </div>
                    <h1 className="mt-1 mb-2 text-2xl font-semibold leading-tight md:text-[28px]">{environment.slug}</h1>
                    <p className="text-kumo-subtle">{environment.description || t('Manage configuration for this environment.')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        shape="square"
                        icon={PencilSimpleIcon}
                        aria-label={t('Edit environment')}
                        onClick={() => setEditing(true)}
                    />
                    <Button
                        variant="ghost"
                        shape="square"
                        icon={TrashIcon}
                        aria-label={t('Delete environment')}
                        onClick={() => setDeleting(true)}
                    />
                </div>
            </header>
            <ErrorMessage error={error} />
            <EnvironmentView key={environment.id} project={project} environment={environment} onChange={refresh} />
            <EntityDialog
                open={editing}
                kind="environment"
                project={project}
                current={environment}
                onClose={() => setEditing(false)}
                onSaved={(result) => {
                    if ('project_id' in result) {
                        setEnvironments((current) => current.map((item) => (item.id === result.id ? { ...item, ...result } : item)));
                    }

                    refresh();
                }}
            />
            <ConfirmDialog
                open={deleting}
                onClose={() => setDeleting(false)}
                title={t('Delete environment')}
                description={t('Delete “{{value1}}”? Its history and related access grants will be removed.', { value1: environment.slug })}
                onConfirm={async () => {
                    await api(`/projects/${project.slug}/environments/${environment.slug}`, {
                        method: 'DELETE',
                    });
                    setEnvironments((current) => current.filter((item) => item.id !== environment.id));
                    navigate(`/projects/${project.slug}`);
                    refresh();
                }}
            />
        </>
    );
}
