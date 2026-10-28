import { useShallow } from 'zustand/react/shallow';
import { useWorkspaceStore } from '../stores/workspace';

/** Select workspace metadata without subscribing pages to unrelated environment requests. */
export function useWorkspace() {
    const workspace = useWorkspaceStore(
        useShallow((state) => ({
            user: state.user,
            projects: state.projects,
            setProjects: state.setProjects,
            loadingProjects: state.loadingProjects,
            error: state.error,
            refresh: state.refresh,
            logout: state.logout,
        })),
    );

    if (!workspace.user) {
        throw new Error('The workspace requires an authenticated session.');
    }

    return { ...workspace, user: workspace.user };
}
