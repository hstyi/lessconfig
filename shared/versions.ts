import parse from 'semver/functions/parse.js';
import gt from 'semver/functions/gt.js';

/** Accept stable release tags in the project's x.y.z format. */
export function isReleaseVersion(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false;
    }

    const version = parse(value);

    return version !== null && version.version === value && version.prerelease.length === 0 && version.build.length === 0;
}

/** Compare valid project release versions using npm's SemVer implementation. */
export function isNewerVersion(candidate: string, current: string): boolean {
    return isReleaseVersion(candidate) && isReleaseVersion(current) && gt(candidate, current);
}
