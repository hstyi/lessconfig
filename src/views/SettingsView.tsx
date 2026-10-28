import { useTranslation } from 'react-i18next';
import { useState, type SubmitEvent } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, message } from '../lib/api.ts';
import { ErrorMessage } from '../components/ErrorMessage';

/** Present account and password settings; language preferences live in the account menu. */
export function SettingsView({ onPasswordChanged }: { onPasswordChanged: () => void }) {
    const { t } = useTranslation();
    const { user } = useWorkspace();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function save(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');

        if (next !== confirm) {
            setError('The new passwords do not match.');

            return;
        }

        setBusy(true);

        try {
            await api('/auth/password', {
                method: 'PUT',
                body: JSON.stringify({ currentPassword: current, newPassword: next }),
            });
            onPasswordChanged();
        } catch (e) {
            setError(message(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <header className="mb-8 border-b border-kumo-line pb-6">
                <h1 className="text-2xl font-semibold md:text-[28px]">{t('Account Settings')}</h1>
                <p className="mt-2 text-kumo-subtle">{t('View your account details and update your password.')}</p>
            </header>
            <div className="mx-auto w-full max-w-4xl space-y-5 pb-8">
                <section className="rounded-lg bg-kumo-base p-6 ring ring-kumo-line">
                    <h2 className="mb-4 text-base font-semibold">{t('Account')}</h2>
                    <Input label={t('Username')} value={user.username} readOnly />
                    {user.role === 'admin' && (
                        <p className="mt-3 text-kumo-subtle">{t('This account has full access to all projects and environments.')}</p>
                    )}
                </section>
                <section className="rounded-lg bg-kumo-base p-6 ring ring-kumo-line">
                    <h2 className="mb-2 text-base font-semibold">{t('Change password')}</h2>
                    <p className="text-kumo-subtle">{t('Changing your password signs out all sessions. API tokens remain valid.')}</p>
                    <form onSubmit={save} className="mt-5 flex flex-col gap-5 [&>button]:self-start">
                        <Input
                            label={t('Current password')}
                            type="password"
                            autoComplete="current-password"
                            value={current}
                            onChange={(e) => setCurrent(e.target.value)}
                            required
                        />
                        <Input
                            label={t('New password')}
                            type="password"
                            autoComplete="new-password"
                            description={t('At least 8 characters')}
                            minLength={8}
                            maxLength={256}
                            value={next}
                            onChange={(e) => setNext(e.target.value)}
                            required
                        />
                        <Input
                            label={t('Confirm new password')}
                            type="password"
                            autoComplete="new-password"
                            minLength={8}
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            required
                        />
                        <ErrorMessage error={t(error)} />
                        <Button type="submit" variant="primary" loading={busy}>
                            {t('Update password and sign out')}
                        </Button>
                    </form>
                </section>
            </div>
        </>
    );
}
