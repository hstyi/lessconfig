/** Derive human-readable labels from canonical catalog names; translations can override them. */
export function projectIconLabel(name: string): string {
    const words = name.replaceAll('-', ' ');

    return words.charAt(0).toUpperCase() + words.slice(1);
}
