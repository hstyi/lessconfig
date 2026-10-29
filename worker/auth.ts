import { body, emptyResponse, fail, json, text, type Principal, type Scope, type UserRole } from './common';
import { createSession, deleteSession, isSessionToken, readSession, SESSION_LIFETIME } from './session';
import { digest, randomToken } from './credentials';

export { digest, randomToken } from './credentials';

const encoder = new TextEncoder();
const cookieName = 'lessconfig_session';

/** A persisted account, independent of the current single-account product interface. */
type UserRecord = {
    id: number;
    username: string;
    role: UserRole;
    password_hash: string;
    password_salt: string;
    password_iterations: number;
    default_password: number;
};

/** Derive a password verifier using the parameters stored with the user. */
async function passwordHash(password: string, salt: string, iterations = 100000) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);

    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' }, key, 256);

    return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare password verifiers in constant time. */
async function verify(password: string, user: UserRecord) {
    const hash = await passwordHash(password, user.password_salt, user.password_iterations);

    return crypto.subtle.timingSafeEqual(encoder.encode(hash), encoder.encode(user.password_hash));
}

/** Build the API-only session cookie; a zero lifetime clears an existing session. */
export function sessionCookie(request: Request, token: string, maxAge = SESSION_LIFETIME) {
    return `${cookieName}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}

/** Prefer an explicit Bearer token, falling back to the browser session cookie. */
export function tokenFrom(request: Request) {
    const authorization = request.headers.get('authorization');

    if (authorization) {
        if (!authorization.startsWith('Bearer ')) {
            fail(401, 'invalid_authorization_header', 'Use a Bearer token.');
        }

        return authorization.slice(7);
    }

    return (
        request.headers
            .get('cookie')
            ?.split(';')
            .map((c) => c.trim())
            .find((c) => c.startsWith(cookieName + '='))
            ?.slice(cookieName.length + 1) ?? ''
    );
}

/** Require same-origin browser mutations while allowing authenticated API clients. */
export function checkOrigin(request: Request) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        return;
    }

    const origin = request.headers.get('origin');

    if (origin && origin !== new URL(request.url).origin) {
        fail(403, 'origin_not_allowed', 'Cross-origin requests are not allowed.');
    }

    if (!request.headers.has('authorization') && request.headers.get('cookie')?.includes(cookieName + '=') && !origin) {
        fail(403, 'origin_required', 'Browser session requests must include an Origin header.');
    }
}

/**
 * Resolve KV sessions or API tokens and load current account permissions from D1.
 * @param request - The incoming request containing a Bearer token or session cookie.
 * @param env - The Worker bindings used to retrieve credentials and grants.
 * @param ctx - Optional context for recording API token usage outside the critical path.
 * @throws ApiError - If credentials have expired, been deleted, or are invalid.
 */
export async function authenticate(request: Request, env: Env, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Principal> {
    const token = tokenFrom(request);

    if (isSessionToken(token)) {
        const session = await readSession(token, env);
        const user = await env.DB.prepare('SELECT id, username, role FROM users WHERE id = ? AND password_salt = ?')
            .bind(session.userId, session.passwordSalt)
            .first<Pick<UserRecord, 'id' | 'username' | 'role'>>();

        if (!user) {
            fail(401, 'session_expired', 'Your session has expired. Sign in again.');
        }

        return {
            kind: 'user',
            role: user.role,
            id: session.id,
            userId: user.id,
            name: user.username,
            scopes: [],
        };
    }

    if (!/^[a-f0-9]{64}$/.test(token)) {
        fail(401, 'authentication_required', 'Sign in or provide a valid API token.');
    }

    const tokenDigest = await digest(token);
    const now = new Date().toISOString();

    const key = await env.DB.prepare(
        'SELECT id, name, last_used_at FROM api_keys WHERE token = ? AND (expires_at IS NULL OR expires_at >= ?)',
    )
        .bind(tokenDigest, now.slice(0, 10))
        .first<{ id: string; name: string; last_used_at: string | null }>();

    if (!key) {
        fail(401, 'invalid_api_token', 'The API token is invalid, expired, or deleted.');
    }

    const scopes = await env.DB.prepare(
        "SELECT COALESCE(project_id, '*') AS project_id, COALESCE(environment_id, '*') AS environment_id, permission FROM api_key_scopes WHERE api_key_id = ?",
    )
        .bind(key.id)
        .all<Scope>();

    if (ctx && (!key.last_used_at || Date.parse(key.last_used_at) < Date.now() - 300000)) {
        ctx.waitUntil(env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(now, key.id).run());
    }

    return { kind: 'key', id: key.id, name: key.name, scopes: scopes.results };
}

/** Authenticate an account and persist a seven-day session in KV. */
export async function login(request: Request, env: Env) {
    const { success } = await env.LOGIN_LIMITER.limit({
        key: request.headers.get('CF-Connecting-IP') ?? 'local',
    });

    if (!success) {
        return json(
            {
                code: 'login_rate_limited',
                message: 'Too many sign-in attempts. Try again in one minute.',
            },
            429,
            {
                'Retry-After': '60',
            },
        );
    }

    const data = await body(request);
    const username = text(data.username, 'Username', 100);
    const password = text(data.password, 'Password', 256);

    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRecord>();

    // Unknown usernames still perform the password derivation to avoid a fast rejection path.
    if (!user) {
        await passwordHash(password, 'unknown-user-password-verifier');
        fail(401, 'invalid_credentials', 'Invalid username or password.');
    }

    if (!(await verify(password, user))) {
        fail(401, 'invalid_credentials', 'Invalid username or password.');
    }

    const { token, id, expiresAt } = await createSession(user.id, user.password_salt, env);

    // Do not return a login issued against credentials revoked while password verification ran.
    const current = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND password_hash = ? AND password_salt = ?')
        .bind(user.id, user.password_hash, user.password_salt)
        .first();

    if (!current) {
        await deleteSession(id, env);
        fail(401, 'password_changed', 'The password has changed. Sign in again.');
    }

    return json(
        { token, expiresAt, username: user.username, role: user.role, kind: 'user', defaultPassword: Boolean(user.default_password) },
        200,
        {
            'Set-Cookie': sessionCookie(request, token),
        },
    );
}

/** Replace the password atomically and revoke the user's sessions without revoking API tokens. */
export async function changePassword(request: Request, env: Env, userId: number) {
    if (env.DISABLE_PASSWORD_CHANGE === 'true') {
        fail(403, 'password_change_disabled', 'Password changes are disabled for this deployment.');
    }

    const data = await body(request);
    const current = text(data.currentPassword, 'Current password', 256);
    const next = text(data.newPassword, 'New password', 256);

    if (next.length < 8) {
        fail(400, 'password_too_short', 'The new password must contain at least 8 characters.');
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRecord>();

    if (!user || !(await verify(current, user))) {
        fail(400, 'invalid_current_password', 'The current password is incorrect.');
    }

    const salt = randomToken('').slice(0, 32);
    const hash = await passwordHash(next, salt);

    // Compare-and-swap prevents two concurrent password changes from overwriting each other.
    const result = await env.DB.prepare(
        'UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = 100000, default_password = 0, updated_at = ? WHERE id = ? AND password_hash = ?',
    )
        .bind(hash, salt, new Date().toISOString(), userId, user.password_hash)
        .run();

    if (!result.meta.changes) {
        fail(409, 'password_conflict', 'The password was changed by another request. Sign in again.');
    }

    return emptyResponse(200, { 'Set-Cookie': sessionCookie(request, '', 0) });
}
