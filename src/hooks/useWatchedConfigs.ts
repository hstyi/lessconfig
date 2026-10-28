import { useEffect, useState } from 'react';
import { ApiError, api, message, type Config, type ListResponse, type WatchResult } from '../lib/api.ts';

/** Complete environment configuration returned independently of watch progress. */
type ConfigurationList = ListResponse<Config>;

/** The last successfully applied configuration remains visible during reloads and reconnection. */
type ConfigurationState = {
    data: ConfigurationList | null;
    revision: number;
    error: string;
    loading: boolean;
    updatedAt: number;
    sync: 'Connecting' | 'Live' | 'Reconnecting' | 'Watch stopped';
};

/**
 * Initialize watch before reading configuration and acknowledge each position only after applying its refresh.
 * @param base - The environment's resource path relative to /api/v1.
 * @param scope - The public project/environment scope used by the shared GET watch endpoint.
 * @param refreshVersion - A manual invalidation that restarts the read-and-watch cycle.
 * @returns The retained list, synchronization status, and safe display state.
 */
export function useWatchedConfigs(base: string, scope: string, refreshVersion: number) {
    const [state, setState] = useState<ConfigurationState>({
        data: null,
        revision: 0,
        error: '',
        loading: true,
        updatedAt: 0,
        sync: 'Connecting',
    });

    useEffect(() => {
        const controller = new AbortController();
        let retryTimer: ReturnType<typeof setTimeout>;
        let resolveDelay: (() => void) | undefined;

        /** Keep pending watch progress separate until its configuration read succeeds. */
        async function synchronize() {
            let revision: number | undefined;
            let pendingRevision: number | undefined;
            let retries = 0;

            while (!controller.signal.aborted) {
                try {
                    if (revision === undefined && pendingRevision === undefined) {
                        const parameters = new URLSearchParams({ scopes: scope });
                        const initial = await api<WatchResult>(`/watch?${parameters}`, { signal: controller.signal });

                        if (controller.signal.aborted) {
                            break;
                        }

                        pendingRevision = initial.revision;
                    }

                    if (pendingRevision !== undefined) {
                        setState((current) => ({ ...current, loading: true }));

                        const data = await api<ConfigurationList>(`${base}/configurations`, {
                            signal: controller.signal,
                        });

                        if (controller.signal.aborted) {
                            break;
                        }

                        revision = pendingRevision;
                        pendingRevision = undefined;
                        setState({
                            data,
                            revision,
                            error: '',
                            loading: false,
                            updatedAt: Date.now(),
                            sync: 'Live',
                        });
                    }

                    const parameters = new URLSearchParams({
                        scopes: scope,
                        revision: String(revision),
                        timeout: '60',
                    });
                    const result = await api<WatchResult>(`/watch?${parameters}`, {
                        signal: controller.signal,
                    });

                    if (controller.signal.aborted) {
                        break;
                    }

                    retries = 0;

                    if (result.changes.length) {
                        pendingRevision = result.revision;
                    } else {
                        revision = result.revision;
                        setState((current) => ({ ...current, revision: result.revision, sync: 'Live', error: '' }));
                    }
                } catch (error) {
                    if (controller.signal.aborted) {
                        break;
                    }

                    if (error instanceof ApiError && ['revision_expired', 'revision_ahead'].includes(error.code)) {
                        revision = undefined;
                        pendingRevision = undefined;

                        continue;
                    }

                    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
                        setState((current) => ({
                            ...current,
                            loading: false,
                            error: message(error),
                            sync: 'Watch stopped',
                        }));

                        break;
                    }

                    setState((current) => ({
                        ...current,
                        loading: false,
                        error: message(error),
                        sync: 'Reconnecting',
                    }));
                    await new Promise<void>((resolve) => {
                        resolveDelay = resolve;
                        retryTimer = setTimeout(resolve, Math.min(30000, 1000 * 2 ** retries) + Math.random() * 500);
                    });
                    retries = Math.min(retries + 1, 5);
                }
            }
        }

        void synchronize();

        return () => {
            controller.abort();
            clearTimeout(retryTimer);
            resolveDelay?.();
        };
    }, [base, scope, refreshVersion]);

    return state;
}
