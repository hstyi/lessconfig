import { create } from 'zustand';
import { api, ApiError, message, type Environment, type ListResponse, type Project, type User } from '../lib/api.ts';

/** Accept a replacement value or an immutable update based on the current value. */
export type Update<T> = T | ((current: T) => T);

/** Keep loaded data visible while a background request updates it. */
export type EnvironmentList = {
    items: Environment[];
    loaded: boolean;
    loading: boolean;
    error: string;
};

export const emptyEnvironmentList: EnvironmentList = {
    items: [],
    loaded: false,
    loading: false,
    error: '',
};

/** Shared session and resource state. Credentials remain in the HttpOnly cookie. */
type WorkspaceState = {
    user: User | null;
    ready: boolean;
    authError: string;
    notice: string;
    projects: Project[];
    loadingProjects: boolean;
    projectsLoaded: boolean;
    error: string;
    environmentLists: Record<string, EnvironmentList>;
    initialize: () => Promise<void>;
    signIn: (user: User) => void;
    expireSession: (notice?: string) => void;
    logout: () => Promise<void>;
    refresh: () => void;
    loadProjects: () => Promise<void>;
    loadEnvironments: (project: Project, force?: boolean) => Promise<void>;
    setProjects: (update: Update<Project[]>) => void;
    setEnvironments: (projectId: string, update: Update<Environment[]>) => void;
};

/** Share requests across routes and cancel stale work whenever the session or resources change. */
export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
    let initialization: Promise<void> | undefined;
    let projectRequest: AbortController | undefined;
    const environmentRequests = new Map<string, AbortController>();

    /** Discard account-scoped metadata and prevent old requests from repopulating it. */
    function clearResources() {
        projectRequest?.abort();
        projectRequest = undefined;

        for (const request of environmentRequests.values()) {
            request.abort();
        }

        environmentRequests.clear();

        return {
            projects: [],
            projectsLoaded: false,
            loadingProjects: true,
            environmentLists: {},
            error: '',
        };
    }

    return {
        user: null,
        ready: false,
        authError: '',
        notice: '',
        projects: [],
        projectsLoaded: false,
        loadingProjects: true,
        error: '',
        environmentLists: {},
        initialize: async () => {
            if (get().ready) {
                return;
            }

            if (initialization) {
                return initialization;
            }

            initialization = (async () => {
                try {
                    get().signIn(await api<User>('/auth/me'));
                } catch (error) {
                    if (!(error instanceof ApiError && error.status === 401)) {
                        set({ authError: message(error) });
                    }
                } finally {
                    set({ ready: true });
                }
            })();

            return initialization;
        },
        signIn: (user) => {
            set({ ...clearResources(), user, ready: true, authError: '', notice: '' });
            void get().loadProjects();
        },
        expireSession: (notice = 'Your session has expired. Please sign in again.') => {
            set({ ...clearResources(), user: null, ready: true, notice });
        },
        logout: async () => {
            try {
                await api('/auth/logout', { method: 'POST' });
                get().expireSession('');
            } catch (error) {
                set({ error: message(error) });
            }
        },
        refresh: () => {
            void get().loadProjects();
        },
        loadProjects: async () => {
            if (!get().user) {
                return;
            }

            projectRequest?.abort();

            const controller = new AbortController();

            projectRequest = controller;
            set({ loadingProjects: !get().projectsLoaded });

            try {
                const { items } = await api<ListResponse<Project>>('/projects', {
                    signal: controller.signal,
                });

                if (!controller.signal.aborted) {
                    set((state) => ({
                        projects: items,
                        projectsLoaded: true,
                        loadingProjects: false,
                        error: '',
                        environmentLists: Object.fromEntries(
                            Object.entries(state.environmentLists).filter(([id]) => items.some((project) => project.id === id)),
                        ),
                    }));
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    set({ error: message(error), loadingProjects: false });
                }
            } finally {
                if (projectRequest === controller) {
                    projectRequest = undefined;
                }
            }
        },
        loadEnvironments: async (project, force = false) => {
            if (!get().user || !get().projects.some((item) => item.id === project.id)) {
                return;
            }

            const previous = get().environmentLists[project.id] ?? emptyEnvironmentList;

            if (!force && (previous.loading || (previous.loaded && !previous.error))) {
                return;
            }

            environmentRequests.get(project.id)?.abort();

            const controller = new AbortController();

            environmentRequests.set(project.id, controller);
            set((state) => ({
                environmentLists: {
                    ...state.environmentLists,
                    [project.id]: { ...previous, loading: true },
                },
            }));

            try {
                const { items } = await api<ListResponse<Environment>>(`/projects/${project.slug}/environments`, {
                    signal: controller.signal,
                });

                if (!controller.signal.aborted && get().projects.some((item) => item.id === project.id)) {
                    set((state) => ({
                        environmentLists: {
                            ...state.environmentLists,
                            [project.id]: { items, loaded: true, loading: false, error: '' },
                        },
                    }));
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    set((state) => ({
                        environmentLists: {
                            ...state.environmentLists,
                            [project.id]: {
                                ...(state.environmentLists[project.id] ?? previous),
                                loaded: true,
                                loading: false,
                                error: message(error),
                            },
                        },
                    }));
                }
            } finally {
                if (environmentRequests.get(project.id) === controller) {
                    environmentRequests.delete(project.id);
                }
            }
        },
        setProjects: (update) => {
            projectRequest?.abort();
            projectRequest = undefined;

            const projects = typeof update === 'function' ? update(get().projects) : update;

            for (const [id, request] of environmentRequests) {
                if (!projects.some((project) => project.id === id)) {
                    request.abort();
                    environmentRequests.delete(id);
                }
            }

            set((state) => ({
                projects,
                projectsLoaded: true,
                loadingProjects: false,
                environmentLists: Object.fromEntries(
                    Object.entries(state.environmentLists).filter(([id]) => projects.some((project) => project.id === id)),
                ),
            }));
        },
        setEnvironments: (projectId, update) => {
            environmentRequests.get(projectId)?.abort();
            environmentRequests.delete(projectId);

            const previous = get().environmentLists[projectId] ?? emptyEnvironmentList;
            const items = typeof update === 'function' ? update(previous.items) : update;

            set((state) => ({
                environmentLists: {
                    ...state.environmentLists,
                    [projectId]: { items, loaded: true, loading: false, error: '' },
                },
            }));
        },
    };
});
