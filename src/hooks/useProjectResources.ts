import { useCallback, useEffect } from 'react';
import type { Environment, Project } from '../lib/api.ts';
import { emptyEnvironmentList, useWorkspaceStore, type Update } from '../stores/workspace';

/** Subscribe the titlebar, sidebar, and project pages to the same environment cache. */
export function useProjectResources(project?: Project, enabled = true) {
    const projectId = project?.id;

    const list = useWorkspaceStore((state) => (projectId ? state.environmentLists[projectId] : undefined) ?? emptyEnvironmentList);

    const loadEnvironments = useWorkspaceStore((state) => state.loadEnvironments);
    const loadProjects = useWorkspaceStore((state) => state.loadProjects);
    const updateEnvironments = useWorkspaceStore((state) => state.setEnvironments);

    useEffect(() => {
        if (project && enabled) {
            void loadEnvironments(project);
        }
    }, [project, enabled, loadEnvironments]);

    const setEnvironments = useCallback(
        (update: Update<Environment[]>) => {
            if (projectId) {
                updateEnvironments(projectId, update);
            }
        },
        [projectId, updateEnvironments],
    );

    const refresh = useCallback(() => {
        if (project) {
            void loadEnvironments(project, true);
        }

        void loadProjects();
    }, [project, loadEnvironments, loadProjects]);

    return {
        project,
        environments: list.items,
        setEnvironments,
        loading: Boolean(project) && !list.loaded,
        error: list.error,
        refresh,
    };
}
