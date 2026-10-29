import { useEffect, useState } from 'react';
import { isNewerVersion, isReleaseVersion } from '../../shared/versions';

export type Release = { version: string; notes: string };

export const releaseRepository = 'https://github.com/lessconfig/lessconfig';
const endpoint = 'https://api.github.com/repos/lessconfig/lessconfig/releases/latest';
let pending: Promise<Release | null> | undefined;

/** Share only concurrent requests; every completed check is discarded. */
async function checkRelease(): Promise<Release | null> {
    if (pending) {
        return pending;
    }

    pending = (async () => {
        let release: Release | null = null;

        try {
            const response = await fetch(endpoint, {
                headers: { Accept: 'application/vnd.github+json' },
                credentials: 'omit',
                cache: 'no-store',
                referrerPolicy: 'no-referrer',
                signal: AbortSignal.timeout(8000),
            });

            if (response.ok) {
                const data = await response.json();

                if (
                    data &&
                    isReleaseVersion(data.tag_name) &&
                    data.draft === false &&
                    data.prerelease === false &&
                    (typeof data.body === 'string' || data.body === null)
                ) {
                    release = { version: data.tag_name, notes: data.body ?? '' };
                }
            }
        } catch {
            // Updates are optional; offline, timeouts, and GitHub errors stay silent.
        }

        return release;
    })().finally(() => {
        pending = undefined;
    });

    return pending;
}

/** Check once when the signed-in layout mounts, without blocking navigation. */
export function useReleaseUpdate() {
    const [release, setRelease] = useState<Release | null>(null);

    useEffect(() => {
        let disposed = false;

        void checkRelease().then((latest) => {
            if (!disposed) {
                setRelease(latest && isNewerVersion(latest.version, __APP_VERSION__) ? latest : null);
            }
        });

        return () => {
            disposed = true;
        };
    }, []);

    return release;
}
