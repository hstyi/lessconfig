import { useParams } from 'react-router';
import { useWorkspaceStore } from '../stores/workspace';
import { useProjectResources } from './useProjectResources';

/** Resolve the route's project and subscribe directly to its shared Zustand metadata. */
export function useProject() {
    const { project: slug } = useParams();
    const project = useWorkspaceStore((state) => state.projects.find((item) => item.slug === slug));
    const resources = useProjectResources(project);

    if (!project) {
        throw new Error('The project route must resolve before rendering its views.');
    }

    return { ...resources, project };
}
