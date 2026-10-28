import { useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { Select } from '@cloudflare/kumo/components/select';
import { Checkbox } from '@cloudflare/kumo/components/checkbox';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { api, message } from '../lib/api.ts';
import { useWorkspace } from '../hooks/useWorkspace';
import { useWorkspaceStore } from '../stores/workspace';
import { ExpirationPicker } from '../components/ExpirationPicker';
import { ErrorMessage } from '../components/ErrorMessage';
import { CopyButton } from '../components/CopyButton';

/** Explicit wildcard shared by the form and the API scope contract. */
const allProjects = '*';

/** One editable resource scope, expanded into individual API grants on submission. */
type Grant = {
    id: string;
    projectId: string;
    environmentIds: string[];
    all: boolean;
    permission: 'read' | 'write';
};

const newGrant = (): Grant => ({
    id: crypto.randomUUID(),
    projectId: '',
    environmentIds: [],
    all: false,
    permission: 'read',
});

/** Create a scoped token directly from the form and display its secret exactly once. */
export function CreateApiKeyView() {
    const { projects } = useWorkspace();
    const { t } = useTranslation();
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [name, setName] = useState('');
    const [expires, setExpires] = useState<string>();
    const [grants, setGrants] = useState<Grant[]>([newGrant()]);
    const environments = useWorkspaceStore((state) => state.environmentLists);
    const loadEnvironments = useWorkspaceStore((state) => state.loadEnvironments);
    const [token, setToken] = useState('');
    const navigate = useNavigate();

    function updateGrant(id: string, patch: Partial<Grant>) {
        setGrants((current) => current.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    }

    function chooseProject(id: string, projectId: string) {
        updateGrant(id, { projectId, environmentIds: [], all: projectId === allProjects });

        const project = projects.find((item) => item.id === projectId);

        if (project) {
            void loadEnvironments(project);
        }
    }

    async function create(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setFormError('');

        if (grants.some((g) => !g.projectId || (!g.all && !g.environmentIds.length))) {
            setFormError('Select a project and environments for each scope.');

            return;
        }

        setBusy(true);

        try {
            const scopes = grants.flatMap((g) =>
                (g.all ? ['*'] : g.environmentIds).map((environment_id) => ({
                    project_id: g.projectId,
                    environment_id,
                    permission: g.permission,
                })),
            );

            const result = await api<{ token: string }>('/api-keys', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    expires_at: expires ?? null,
                    scopes,
                }),
            });

            setToken(result.token);
        } catch (e) {
            setFormError(message(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="mx-auto w-full max-w-5xl pb-8">
            <header className="mb-6">
                <h1 className="mb-2 text-2xl font-semibold md:text-[28px]">{t(token ? 'API token created' : 'Create API token')}</h1>
                <p className="text-kumo-subtle">
                    {t(
                        token
                            ? 'This token is shown only once. Copy it and store it securely.'
                            : 'Choose the resources and permissions this token can access.',
                    )}
                </p>
            </header>
            {token ? (
                <section className="space-y-5 rounded-lg bg-kumo-base p-5 ring ring-kumo-line">
                    <code className="block wrap-anywhere rounded-md bg-kumo-tint p-4 font-mono text-[0.9em] select-all">{token}</code>
                    <div className="flex justify-end gap-3">
                        <CopyButton value={token} label={t('Copy API token')} />
                        <Button variant="primary" onClick={() => navigate('/api-keys')}>
                            {t('Done')}
                        </Button>
                    </div>
                </section>
            ) : (
                <form onSubmit={create} className="space-y-5">
                    <section className="rounded-lg bg-kumo-base p-5 ring ring-kumo-line">
                        <Input
                            label={t('Name')}
                            placeholder={t('e.g. payment-production')}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={100}
                            required
                        />
                    </section>
                    <section className="space-y-4 rounded-lg bg-kumo-base p-5 ring ring-kumo-line">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-semibold">{t('Permissions and resources')}</h3>
                            <Button type="button" variant="ghost" icon={PlusIcon} onClick={() => setGrants([...grants, newGrant()])}>
                                {t('Add scope')}
                            </Button>
                        </div>
                        <div className="flex flex-col gap-4">
                            {grants.map((grant, index) => (
                                <div className="rounded bg-kumo-base p-4 ring ring-kumo-line" key={grant.id}>
                                    <div className="mb-2.5 flex items-center justify-between">
                                        <span className="text-kumo-subtle">{t('Scope number', { count: index + 1 })}</span>
                                        <Button
                                            variant="ghost"
                                            type="button"
                                            shape="square"
                                            aria-label={t('Remove scope {{value1}}', { value1: index + 1 })}
                                            disabled={grants.length === 1}
                                            icon={TrashIcon}
                                            onClick={() => setGrants(grants.filter((g) => g.id !== grant.id))}
                                        />
                                    </div>
                                    <div className="grid items-start gap-4 sm:grid-cols-2">
                                        <Select
                                            className="w-full min-w-0 justify-between"
                                            label={t('Project')}
                                            placeholder={t('Select a project')}
                                            value={grant.projectId || null}
                                            items={[
                                                {
                                                    value: allProjects,
                                                    label: t('All projects'),
                                                },
                                                ...projects.map((p) => ({ value: p.id, label: p.name })),
                                            ]}
                                            onValueChange={(value) => {
                                                if (value) {
                                                    void chooseProject(grant.id, value);
                                                }
                                            }}
                                        >
                                            <Select.Option value={allProjects}>{t('All projects')}</Select.Option>
                                            {projects.map((p) => (
                                                <Select.Option key={p.id} value={p.id}>
                                                    {p.name}
                                                </Select.Option>
                                            ))}
                                        </Select>
                                        <Select
                                            className="w-full min-w-0 justify-between"
                                            label={t('Permission')}
                                            value={grant.permission}
                                            items={{ read: t('Read'), write: t('Edit') }}
                                            onValueChange={(value) => {
                                                if (value) {
                                                    updateGrant(grant.id, { permission: value as 'read' | 'write' });
                                                }
                                            }}
                                        >
                                            <Select.Option value="read">{t('Read')}</Select.Option>
                                            <Select.Option value="write">{t('Edit')}</Select.Option>
                                        </Select>
                                    </div>
                                    <div className="mt-4 border-t border-kumo-line pt-4">
                                        <Checkbox
                                            label={t('All environments')}
                                            checked={grant.all}
                                            disabled={!grant.projectId || grant.projectId === allProjects}
                                            onCheckedChange={(checked) => updateGrant(grant.id, { all: checked, environmentIds: [] })}
                                        />
                                        {!grant.all && grant.projectId && (
                                            <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-3 [&_code]:ml-1 [&_code]:text-kumo-subtle">
                                                {!environments[grant.projectId]?.loaded ? (
                                                    <span className="text-kumo-subtle">{t('Loading environments…')}</span>
                                                ) : environments[grant.projectId].items.length ? (
                                                    environments[grant.projectId].items.map((e) => (
                                                        <Checkbox
                                                            key={e.id}
                                                            label={
                                                                <span>
                                                                    {e.slug}
                                                                    {e.description && (
                                                                        <span className="text-kumo-subtle"> · {e.description}</span>
                                                                    )}
                                                                </span>
                                                            }
                                                            checked={grant.environmentIds.includes(e.id)}
                                                            onCheckedChange={(checked) =>
                                                                updateGrant(grant.id, {
                                                                    environmentIds: checked
                                                                        ? [...grant.environmentIds, e.id]
                                                                        : grant.environmentIds.filter((id) => id !== e.id),
                                                                })
                                                            }
                                                        />
                                                    ))
                                                ) : (
                                                    <span className="text-kumo-subtle">
                                                        {t(
                                                            'This project has no environments. Create one or grant access to all environments.',
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                    <section className="rounded-lg bg-kumo-base p-5 ring ring-kumo-line">
                        <ExpirationPicker value={expires} onChange={setExpires} />
                    </section>
                    <ErrorMessage error={formError || grants.map((grant) => environments[grant.projectId]?.error).find(Boolean)} />
                    <div className="flex items-center justify-between gap-3 border-t border-kumo-line pt-5">
                        <Button type="button" disabled={busy} onClick={() => navigate('/api-keys')}>
                            {t('Cancel')}
                        </Button>
                        <Button type="submit" variant="primary" loading={busy}>
                            {t('Create API token')}
                        </Button>
                    </div>
                </form>
            )}
        </div>
    );
}
