import { isPlainObject, isString, uniqBy } from 'lodash-es';
import { isIdentifier } from '../../shared/identifiers';
import { ApiError, api, listItems, message, revisionHeaders, type Config, type ConfigType, type Environment, type Project } from './api.ts';

export type TransferConfig = Pick<Config, 'key' | 'value' | 'type' | 'description'>;
export type TransferEnvironment = { slug: string; description: string; configs: TransferConfig[] };
export type TransferProject = {
    slug: string;
    name: string;
    icon: Project['icon'];
    description: string;
    environments: TransferEnvironment[];
};
export type WorkspaceTransfer = { version: 1; projects: TransferProject[] };
export type ImportResult = { projects: number; environments: number; configs: number; failures: { path: string; reason: string }[] };

const types = new Set<ConfigType>(['text', 'boolean', 'number', 'json', 'yaml', 'properties']);

function invalid(): never {
    throw new Error('Invalid workspace file. Check the format and required fields.');
}
/**
 * Require a plain JSON object before accessing imported fields.
 * @param value - The untrusted value from the workspace file.
 * @returns The validated record.
 */
function record(value: unknown): Record<string, unknown> {
    if (!isPlainObject(value)) {
        return invalid();
    }
    return value as Record<string, unknown>;
}
/**
 * Validate an imported string without changing its content.
 * @param value - The untrusted field value.
 * @param max - The maximum length, or null for unrestricted configuration content.
 * @param required - Whether the string must contain non-whitespace characters.
 * @returns The original validated string.
 */
function string(value: unknown, max: number | null, required = false): string {
    if (!isString(value) || (max !== null && value.length > max) || (required && !value.trim())) {
        return invalid();
    }
    return value;
}
/**
 * Validate the format of a project, environment, or configuration identifier.
 * @param value - The untrusted identifier.
 * @returns The validated identifier.
 */
function identifier(value: unknown): string {
    if (!isIdentifier(value)) {
        return invalid();
    }
    return value;
}
/**
 * Reject duplicate identifiers instead of silently discarding imported records.
 * @param values - The records to validate.
 * @param key - The identifier selector for each record.
 * @returns All original records when their identifiers are unique.
 */
function unique<T>(values: T[], key: (value: T) => string): T[] {
    if (uniqBy(values, key).length !== values.length) {
        throw new Error('The file contains duplicate project, environment, or configuration identifiers.');
    }
    return values;
}

/** Validate the complete file structure before applying any changes. */
export function parseWorkspace(text: string): WorkspaceTransfer {
    const root = record(JSON.parse(text));
    if (root.version !== 1 || !Array.isArray(root.projects)) {
        return invalid();
    }
    const projects = unique(
        root.projects.map((raw: unknown): TransferProject => {
            const project = record(raw);
            if (!Array.isArray(project.environments)) {
                return invalid();
            }
            const environments = unique(
                project.environments.map((rawEnvironment: unknown): TransferEnvironment => {
                    const environment = record(rawEnvironment);
                    if (!Array.isArray(environment.configs)) {
                        return invalid();
                    }
                    const configs = unique(
                        environment.configs.map((rawConfig: unknown): TransferConfig => {
                            const config = record(rawConfig);
                            const type = string(config.type, 20) as ConfigType;
                            if (!types.has(type)) {
                                return invalid();
                            }
                            return {
                                key: identifier(config.key),
                                value: string(config.value, null),
                                type,
                                description: string(config.description, 500),
                            };
                        }),
                        (config) => config.key,
                    );
                    return { slug: identifier(environment.slug), description: string(environment.description, 500), configs };
                }),
                (environment) => environment.slug,
            );
            return {
                slug: identifier(project.slug),
                name: string(project.name, 120, true),
                icon: string(project.icon, 100, true) as Project['icon'],
                description: string(project.description, 500),
                environments,
            };
        }),
        (project) => project.slug,
    );
    return { version: 1, projects };
}

/** Read each level through the existing API; include empty projects and environments. */
export async function exportWorkspace(progress: (path: string) => void): Promise<WorkspaceTransfer> {
    const projects = await listItems<Project>('/projects');
    const output: TransferProject[] = [];
    for (const project of projects) {
        progress(project.slug);
        const path = `/projects/${encodeURIComponent(project.slug)}`;
        const environments = await listItems<Environment>(`${path}/environments`);
        const exportedEnvironments: TransferEnvironment[] = [];
        for (const environment of environments) {
            progress(`${project.slug}/${environment.slug}`);
            const configs = await listItems<Config>(`${path}/environments/${encodeURIComponent(environment.slug)}/configurations`);
            exportedEnvironments.push({
                slug: environment.slug,
                description: environment.description,
                configs: configs.map(({ key, value, type, description }) => ({ key, value, type, description })),
            });
        }
        output.push({
            slug: project.slug,
            name: project.name,
            icon: project.icon,
            description: project.description,
            environments: exportedEnvironments,
        });
    }
    return { version: 1, projects: output };
}

/** Reconcile entries with the API, retaining successful writes and reporting failures by path. */
export async function importWorkspace(data: WorkspaceTransfer, progress: (path: string) => void): Promise<ImportResult> {
    const result: ImportResult = { projects: 0, environments: 0, configs: 0, failures: [] };
    const existingProjects = new Set((await listItems<Project>('/projects')).map((project) => project.slug));
    for (const project of data.projects) {
        const projectPath = `/projects/${encodeURIComponent(project.slug)}`;
        progress(project.slug);
        let existingEnvironments: Set<string>;
        try {
            const { slug, name, icon, description } = project;
            await api(existingProjects.has(slug) ? projectPath : '/projects', {
                method: existingProjects.has(slug) ? 'PATCH' : 'POST',
                body: JSON.stringify({ slug, name, icon, description }),
            });
            result.projects++;
            existingEnvironments = new Set(
                (await listItems<Environment>(`${projectPath}/environments`)).map((environment) => environment.slug),
            );
        } catch (error) {
            result.failures.push({ path: project.slug, reason: message(error) });
            if (error instanceof ApiError && error.status === 401) {
                return result;
            }
            continue;
        }
        for (const environment of project.environments) {
            const displayPath = `${project.slug}/${environment.slug}`;
            const envPath = `${projectPath}/environments/${encodeURIComponent(environment.slug)}`;
            progress(displayPath);
            let revisions: Map<string, number>;
            try {
                await api(existingEnvironments.has(environment.slug) ? envPath : `${projectPath}/environments`, {
                    method: existingEnvironments.has(environment.slug) ? 'PATCH' : 'POST',
                    body: JSON.stringify({ slug: environment.slug, description: environment.description }),
                });
                result.environments++;
                revisions = new Map((await listItems<Config>(`${envPath}/configurations`)).map((config) => [config.key, config.revision]));
            } catch (error) {
                result.failures.push({ path: displayPath, reason: message(error) });
                if (error instanceof ApiError && error.status === 401) {
                    return result;
                }
                continue;
            }
            for (const config of environment.configs) {
                const configPath = `${displayPath}/${config.key}`;
                progress(configPath);
                try {
                    await api(`${envPath}/configurations/${encodeURIComponent(config.key)}`, {
                        method: 'PUT',
                        headers: revisionHeaders(revisions.get(config.key)),
                        body: JSON.stringify({ value: config.value, type: config.type, description: config.description }),
                    });
                    result.configs++;
                } catch (error) {
                    result.failures.push({ path: configPath, reason: message(error) });
                    if (error instanceof ApiError && error.status === 401) {
                        return result;
                    }
                }
            }
        }
    }
    return result;
}
