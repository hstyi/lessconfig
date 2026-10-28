import { useEffect, useState } from 'react';
import { api, message, type ListResponse } from '../lib/api.ts';

/** Retain the last list during revalidation and ignore canceled or superseded responses. */
export function useApiList<T>(path: string, { enabled = true, delay = 0, revision = 0 } = {}) {
    const query = `${path}:${revision}`;

    const [state, setState] = useState<{
        data: ListResponse<T> | null;
        error: string;
        pending: boolean;
        query: string | null;
        updatedAt: number;
    }>({ data: null, error: '', pending: true, query: null, updatedAt: 0 });

    useEffect(() => {
        if (!enabled) {
            return;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => {
            setState((current) => ({ ...current, pending: true }));
            void api<ListResponse<T>>(path, { signal: controller.signal })
                .then((data) => {
                    if (!controller.signal.aborted) {
                        setState({ data, query, pending: false, error: '', updatedAt: Date.now() });
                    }
                })
                .catch((error) => {
                    if (!controller.signal.aborted) {
                        setState((current) => ({ ...current, query, pending: false, error: message(error) }));
                    }
                });
        }, delay);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [path, query, enabled, delay]);

    return {
        data: state.data,
        updatedAt: state.updatedAt,
        error: state.query === query ? state.error : '',
        loading: enabled && (state.pending || state.query !== query),
    };
}
