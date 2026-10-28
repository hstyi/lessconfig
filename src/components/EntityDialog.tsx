import { lazy, Suspense, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@cloudflare/kumo/components/input';
import { Button } from '@cloudflare/kumo/components/button';
import { api, message, type Project, type Environment } from '../lib/api.ts';
import { Modal } from './Modal';
import { ErrorMessage } from './ErrorMessage';
import type { PhosphorIcon } from '@phosphor-icons/core';
import { IDENTIFIER_PATTERN } from '../../shared/identifiers';

// The complete catalog is needed only while a project form is open.
const ProjectIconPicker = lazy(() => import('./ProjectIconPicker').then((module) => ({ default: module.ProjectIconPicker })));

type EntityDialogProps = {
    open: boolean;
    kind: 'project' | 'environment';
    project?: Project;
    current?: Project | Environment;
    onClose: () => void;
    onSaved: (entity: Project | Environment) => void;
};

/** Edit project metadata or environment remarks while keeping resource slugs immutable. */
export function EntityDialog({ open, kind, project, current, onClose, onSaved }: EntityDialogProps) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [description, setDescription] = useState('');
    const [icon, setIcon] = useState<PhosphorIcon['name']>('folder-simple');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const session = open ? `${kind}:${current?.id ?? 'new'}` : null;
    const [previousSession, setPreviousSession] = useState(session);

    // Reset before rendering a new dialog session so stale fields are never painted.
    if (session !== previousSession) {
        setPreviousSession(session);

        if (open) {
            setName(current && 'name' in current ? current.name : '');
            setIcon(current && 'icon' in current ? current.icon : 'folder-simple');
            setSlug(current?.slug ?? '');
            setDescription(current && 'description' in current ? current.description : '');
            setError('');
        }
    }

    async function save(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError('');

        try {
            const base = kind === 'project' ? '/projects' : `/projects/${project?.slug}/environments`;

            const result = await api<Project | Environment>(base + (current ? `/${current.slug}` : ''), {
                method: current ? 'PATCH' : 'POST',
                body: JSON.stringify(kind === 'project' ? { name, slug, icon, description } : { slug, description }),
            });

            onClose();
            onSaved(result);
        } catch (error) {
            setError(message(error));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={() => {
                if (!busy) {
                    onClose();
                }
            }}
            title={
                kind === 'project'
                    ? current
                        ? t('Edit project')
                        : t('Create project')
                    : current
                      ? t('Edit environment')
                      : t('Create environment')
            }
        >
            <form onSubmit={save}>
                {kind === 'project' && (
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-4">
                        <Suspense fallback={<div className="h-16 w-16" aria-label={t('Loading icons…')} />}>
                            <ProjectIconPicker value={icon} onChange={setIcon} />
                        </Suspense>
                        <Input
                            label={t('Name')}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            maxLength={120}
                            required
                            placeholder={t('e.g. Payment service')}
                        />
                    </div>
                )}
                <Input
                    label={t(kind === 'environment' ? 'Identifier' : 'Slug')}
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                    disabled={Boolean(current)}
                    description={t(
                        'Used in API paths. Letters, numbers, dots, hyphens, and underscores only. Case-sensitive and cannot be changed later.',
                    )}
                    placeholder={kind === 'project' ? 'payment' : 'prod'}
                    pattern={IDENTIFIER_PATTERN.source}
                    required
                />
                <Input
                    label={t(kind === 'environment' ? 'Remarks (optional)' : 'Description (optional)')}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={500}
                />
                <ErrorMessage error={error} />
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2.5 border-t border-kumo-line pt-5 [&>.text-kumo-subtle:first-child]:mr-auto">
                    <Button type="button" disabled={busy} onClick={onClose}>
                        {t('Cancel')}
                    </Button>
                    <Button variant="primary" type="submit" loading={busy}>
                        {current ? t('Save changes') : t('Create')}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
