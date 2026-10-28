import { isString } from 'lodash-es';
import { fail } from './common';
import { digest, randomToken } from './credentials';

/** Sessions and their browser cookies expire after seven days without sliding renewal. */
export const SESSION_LIFETIME = 7 * 24 * 60 * 60;

/** The password salt binds a session to existing credentials without a new database field. */
type SessionRecord = { userId: number; passwordSalt: string; expiresAt: number };

/**
 * Distinguish opaque account sessions from unprefixed API tokens.
 * @param token - The credential supplied by the client.
 * @returns Whether the credential has the account-session format.
 */
export function isSessionToken(token: string): boolean {
    return /^lcs_[a-f0-9]{64}$/.test(token);
}

/**
 * Store an opaque session in KV with automatic expiration.
 * @param userId - The authenticated account identifier.
 * @param passwordSalt - The account's current salt, changed whenever its password changes.
 * @param env - Worker bindings containing the session namespace.
 * @returns The client credential, its storage identity, and the UTC expiration timestamp.
 */
export async function createSession(userId: number, passwordSalt: string, env: Env) {
    const token = randomToken('lcs_');
    const id = await digest(token);
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME;
    const session: SessionRecord = { userId, passwordSalt, expiresAt };

    // Persist before returning the cookie; each login writes a new key exactly once.
    await env.SESSIONS.put(`session:${id}`, JSON.stringify(session), { expiration: expiresAt });

    return { token, id, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

/**
 * Resolve a server-side session and independently enforce its absolute expiration.
 * @param token - The opaque credential supplied by the client.
 * @param env - Worker bindings containing the session namespace.
 * @returns The session identity and account credentials to validate against D1.
 */
export async function readSession(token: string, env: Env) {
    const id = await digest(token);
    const session = await env.SESSIONS.get<SessionRecord>(`session:${id}`, 'json');

    if (
        !session ||
        !Number.isSafeInteger(session.userId) ||
        session.userId < 1 ||
        !isString(session.passwordSalt) ||
        !session.passwordSalt ||
        !Number.isSafeInteger(session.expiresAt) ||
        session.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
        fail(401, 'session_expired', 'Your session has expired. Sign in again.');
    }

    return { ...session, id };
}

/**
 * Delete one session; KV propagation can delay revocation in other locations.
 * @param id - The SHA-256 storage identity of the session credential.
 * @param env - Worker bindings containing the session namespace.
 */
export async function deleteSession(id: string, env: Env): Promise<void> {
    await env.SESSIONS.delete(`session:${id}`);
}
