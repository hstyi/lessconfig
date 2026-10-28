/**
 * Generate a credential with 256 bits of cryptographic entropy.
 * @param prefix - Optional text distinguishing the credential type.
 * @returns The prefix followed by a random hexadecimal value.
 */
export function randomToken(prefix = ''): string {
    return prefix + Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash a high-entropy credential before using it as a storage key or verifier.
 * @param value - The credential to hash.
 * @returns Its hexadecimal SHA-256 digest.
 */
export async function digest(value: string): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
}
