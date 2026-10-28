import { lazy, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LinkProvider } from '@cloudflare/kumo';
import { Button } from '@cloudflare/kumo/components/button';
import { useWorkspaceStore } from './stores/workspace';
import { RouterLink } from './components/RouterLink';
import { ErrorMessage } from './components/ErrorMessage';
import { AppLayout } from './layouts/AppLayout';
import { PageLayout } from './layouts/PageLayout';
import { ProjectLayout } from './layouts/ProjectLayout';
import { LoginView } from './views/LoginView';
import { ProjectsView } from './views/ProjectsView';
import { NotFoundView } from './views/NotFoundView';

const ProjectOverviewView = lazy(() => import('./views/ProjectOverviewView').then((m) => ({ default: m.ProjectOverviewView })));

const ProjectView = lazy(() => import('./views/ProjectView').then((m) => ({ default: m.ProjectView })));

const CreateApiKeyView = lazy(() => import('./views/CreateApiKeyView').then((m) => ({ default: m.CreateApiKeyView })));

const ApiKeysView = lazy(() => import('./views/ApiKeysView').then((m) => ({ default: m.ApiKeysView })));

const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })));

const ImportExportView = lazy(() => import('./views/ImportExportView').then((m) => ({ default: m.ImportExportView })));

const IntegrationGuideView = lazy(() => import('./views/IntegrationGuideView').then((m) => ({ default: m.IntegrationGuideView })));

/** Restore the administrator session and declare all browser routes in one place. */
export default function App() {
    const { t } = useTranslation();
    const location = useLocation();
    const requestedPath = location.state?.from;

    const returnTo =
        typeof requestedPath === 'string' &&
        requestedPath.startsWith('/') &&
        !requestedPath.startsWith('//') &&
        !requestedPath.startsWith('/login')
            ? requestedPath
            : '/projects';

    const { user, ready, authError, notice, initialize, signIn, expireSession } = useWorkspaceStore(
        useShallow((state) => ({
            user: state.user,
            ready: state.ready,
            authError: state.authError,
            notice: state.notice,
            initialize: state.initialize,
            signIn: state.signIn,
            expireSession: state.expireSession,
        })),
    );

    useEffect(() => {
        void initialize();

        const expired = () => expireSession();

        window.addEventListener('session-expired', expired);

        return () => window.removeEventListener('session-expired', expired);
    }, [initialize, expireSession]);

    if (!ready || authError) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-5 text-kumo-subtle">
                {authError ? (
                    <>
                        <ErrorMessage error={authError} />
                        <Button onClick={() => window.location.reload()}>{t('Reconnect')}</Button>
                    </>
                ) : (
                    t('Connecting to your workspace…')
                )}
            </div>
        );
    }

    if (!user) {
        return (
            <>
                {notice && (
                    <div
                        className="fixed bottom-6 left-1/2 z-100 flex max-w-[90vw] -translate-x-1/2 items-center gap-4 rounded-lg bg-slate-800 px-4 py-3.5 text-white"
                        role="status"
                    >
                        {t(notice)}
                    </div>
                )}
                <Routes>
                    <Route path="/login" element={<LoginView onLogin={signIn} />} />
                    <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
                </Routes>
            </>
        );
    }

    return (
        <LinkProvider component={RouterLink}>
            <Routes>
                <Route element={<AppLayout />}>
                    <Route path="projects/:project" element={<ProjectLayout />}>
                        <Route index element={<ProjectOverviewView />} />
                        <Route path="environments/:environment" element={<ProjectView />} />
                    </Route>
                    <Route element={<PageLayout />}>
                        <Route index element={<Navigate to="/projects" replace />} />
                        <Route path="projects" element={<ProjectsView />} />
                        <Route path="api-keys" element={<ApiKeysView />} />
                        <Route path="api-keys/new" element={<CreateApiKeyView />} />
                        <Route path="import-export" element={<ImportExportView />} />
                        <Route path="integration" element={<IntegrationGuideView />} />
                        <Route
                            path="settings"
                            element={
                                <SettingsView
                                    onPasswordChanged={() => {
                                        expireSession('Password updated. Sign in with your new password.');
                                    }}
                                />
                            }
                        />
                        <Route path="login" element={<Navigate to={returnTo} replace />} />
                        <Route path="*" element={<NotFoundView />} />
                    </Route>
                </Route>
            </Routes>
        </LinkProvider>
    );
}
