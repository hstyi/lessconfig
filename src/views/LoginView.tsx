import { Link } from 'react-router';
import { LanguageSelect } from '../components/LanguageSelect';
import { useTranslation } from 'react-i18next';
import { useState, type SubmitEvent } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { SlidersHorizontalIcon } from '@phosphor-icons/react';
import { api, message, type User } from '../lib/api.ts';
import { ErrorMessage } from '../components/ErrorMessage';

/** Authenticate the single administrator without storing the login token in JavaScript storage. */
export function LoginView({ onLogin }: { onLogin: (user: User) => void }) {
    const { t } = useTranslation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    /**
     * Authenticate using the supplied username and password.
     * @param event - The form submission event.
     */
    async function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();

        if (busy) {
            return;
        }

        setBusy(true);
        setError('');

        try {
            const result = await api<User>('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });

            onLogin(result);
        } catch (e) {
            setError(message(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="relative grid min-h-dvh bg-kumo-base lg:grid-cols-2">
            <header className="absolute inset-x-0 top-0 z-10 flex h-20 items-center justify-between gap-3 px-4 sm:px-8 lg:left-1/2">
                <Link to="/projects" aria-label="lessconfig" className="flex items-center gap-3 text-xl font-semibold">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-orange-500 text-white">
                        <SlidersHorizontalIcon size={22} aria-hidden="true" />
                    </span>
                    <span>
                        lessconfig<span className="text-orange-500">.</span>
                    </span>
                </Link>
                <LanguageSelect />
            </header>
            <section className="flex min-w-0 items-center justify-center px-6 pt-24 pb-40 sm:px-10 lg:col-start-2 lg:row-start-1 lg:pb-48">
                <div className="w-full max-w-sm">
                    <div className="mb-8 text-center">
                        <h1 className="text-2xl font-semibold">{t('Sign in')}</h1>
                        <p className="mt-2 text-kumo-subtle">{t('Sign in to manage your configuration.')}</p>
                    </div>
                    <form className="flex flex-col gap-5" onSubmit={submit}>
                        <Input
                            label={t('Username')}
                            name="username"
                            size="lg"
                            className="px-3"
                            autoComplete="username"
                            value={username}
                            disabled={busy}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                        <Input
                            label={t('Password')}
                            name="password"
                            type="password"
                            size="lg"
                            className="px-3"
                            autoComplete="current-password"
                            value={password}
                            disabled={busy}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                        <ErrorMessage error={error} />
                        <Button variant="primary" type="submit" loading={busy} disabled={busy} className="mt-2 h-10 w-full justify-center">
                            {t('Sign in')}
                        </Button>
                    </form>
                </div>
            </section>
            <div
                aria-hidden="true"
                data-testid="login-artwork"
                className="relative hidden items-center overflow-hidden bg-linear-to-r from-[#c9532a] to-[#f36b35] lg:col-start-1 lg:row-start-1 lg:flex"
            >
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-1/4 aspect-square w-[130%] rounded-full bg-[repeating-linear-gradient(135deg,transparent_0px,transparent_7px,rgba(255,255,255,0.16)_7px,rgba(255,255,255,0.16)_9px)] mask-[radial-gradient(circle,black_35%,transparent_70%)]"
                />
                <svg viewBox="0 0 520 480" className="relative mx-auto w-[min(78%,520px)]" fill="none" aria-hidden="true">
                    <circle cx="260" cy="240" r="180" stroke="white" strokeOpacity="0.18" />
                    <circle cx="260" cy="240" r="140" stroke="white" strokeOpacity="0.12" />
                    <path d="M260 130v-34M260 350v34M150 240h-34M370 240h34" stroke="white" strokeOpacity="0.35" strokeWidth="2" />
                    <rect
                        x="106"
                        y="120"
                        width="308"
                        height="240"
                        rx="24"
                        fill="white"
                        fillOpacity="0.14"
                        stroke="white"
                        strokeOpacity="0.35"
                    />
                    <rect x="130" y="149" width="260" height="52" rx="12" fill="white" fillOpacity="0.18" />
                    <rect x="130" y="214" width="260" height="52" rx="12" fill="white" fillOpacity="0.18" />
                    <rect x="130" y="279" width="260" height="52" rx="12" fill="white" fillOpacity="0.18" />
                    <circle cx="154" cy="175" r="5" fill="white" fillOpacity="0.85" />
                    <circle cx="154" cy="240" r="5" fill="white" fillOpacity="0.85" />
                    <circle cx="154" cy="305" r="5" fill="white" fillOpacity="0.85" />
                    <path
                        d="M175 175h86M175 240h118M175 305h68"
                        stroke="white"
                        strokeOpacity="0.65"
                        strokeWidth="6"
                        strokeLinecap="round"
                    />
                    <rect x="320" y="164" width="48" height="22" rx="11" fill="white" fillOpacity="0.85" />
                    <circle cx="357" cy="175" r="7" fill="#e66a3c" />
                    <rect x="320" y="229" width="48" height="22" rx="11" fill="white" fillOpacity="0.32" />
                    <circle cx="331" cy="240" r="7" fill="white" />
                    <rect x="320" y="294" width="48" height="22" rx="11" fill="white" fillOpacity="0.85" />
                    <circle cx="357" cy="305" r="7" fill="#e66a3c" />
                    <circle cx="260" cy="96" r="5" fill="white" fillOpacity="0.8" />
                    <circle cx="260" cy="384" r="5" fill="white" fillOpacity="0.8" />
                    <circle cx="116" cy="240" r="5" fill="white" fillOpacity="0.8" />
                    <circle cx="404" cy="240" r="5" fill="white" fillOpacity="0.8" />
                </svg>
            </div>
        </main>
    );
}
