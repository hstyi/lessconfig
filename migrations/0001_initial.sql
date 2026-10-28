-- Bootstrap one account. The salted password hash is for admin/admin.
-- Migrations run once; changing the password never re-seeds this row.
CREATE TABLE users (
    -- Internal account identifier; the initial administrator has ID 1.
    id INTEGER PRIMARY KEY,

    -- Unique username used to sign in.
    username TEXT NOT NULL UNIQUE,

    -- Account role determines administrative access.
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),

    -- Hex-encoded PBKDF2-SHA-256 password verifier.
    password_hash TEXT NOT NULL,

    -- Hex-encoded random salt used to derive the password verifier.
    password_salt TEXT NOT NULL,

    -- PBKDF2 iteration count used for the stored password verifier.
    password_iterations INTEGER NOT NULL,

    -- Whether the account still uses its initial password (1 = yes, 0 = no).
    default_password INTEGER NOT NULL DEFAULT 1,

    -- UTC timestamp of the most recent password change or account creation.
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO users (
    id,
    username,
    role,
    password_hash,
    password_salt,
    password_iterations
)
VALUES (
    1,
    'admin',
    'admin',
    'fb56daffac5a2796d82d2e4e6183770d29abd7ca9b9b8625817468d0780c0bed',
    '518ad5947fd5d15ef5b838a004d1dd3b',
    100000
);

-- Top-level namespaces for independently managed configuration environments.
CREATE TABLE projects (
    -- Immutable internal project identifier.
    id TEXT PRIMARY KEY,

    -- Unique immutable project identifier used in public API paths.
    slug TEXT NOT NULL UNIQUE,

    -- Editable display name shown in the console.
    name TEXT NOT NULL,

    -- Icon name from the official Phosphor catalog.
    icon TEXT NOT NULL DEFAULT 'folder-simple',

    -- Optional project notes; an empty string means no description.
    description TEXT NOT NULL DEFAULT '',

    -- UTC creation timestamp used to order projects from oldest to newest.
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Each environment belongs to exactly one project.
CREATE TABLE environments (
    -- Immutable internal environment identifier.
    id TEXT PRIMARY KEY,

    -- Owning project; also the leading column of the unique path index below.
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Immutable public identifier, unique within its project.
    slug TEXT NOT NULL,

    -- Editable environment notes; an empty string means no description.
    description TEXT NOT NULL DEFAULT '',

    -- Global revision of the latest configuration change in this environment.
    revision INTEGER NOT NULL DEFAULT 0,

    -- UTC creation timestamp used to order environments from oldest to newest.
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    UNIQUE (project_id, slug)
);

-- Current configuration values; the primary key also supports environment lists.
CREATE TABLE config_entries (
    -- Owning environment; configurations cannot exist without it.
    environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,

    -- Configuration identifier, unique within its environment.
    key TEXT NOT NULL,

    -- Configuration content stored as text without rewriting its formatting.
    value TEXT NOT NULL,

    -- Content format used for validation and editor selection.
    type TEXT NOT NULL CHECK (type IN ('text', 'boolean', 'number', 'json', 'yaml', 'properties')),

    -- Optional configuration notes.
    description TEXT NOT NULL DEFAULT '',

    -- Global revision of this value, also used for conditional writes.
    revision INTEGER NOT NULL,

    -- UTC creation timestamp used to order configurations from oldest to newest.
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    -- UTC timestamp of the latest successful change to this configuration.
    updated_at TEXT NOT NULL,

    PRIMARY KEY (environment_id, key)
);

-- Configuration snapshots retained for browsing, comparison, and restoration.
CREATE TABLE config_history (
    -- Unique identifier of the history entry.
    id TEXT PRIMARY KEY,

    -- Owning environment; removing an empty environment removes its history.
    environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,

    -- Configuration key captured by this history entry.
    key TEXT NOT NULL,

    -- Saved content; deletion entries retain the value that was removed.
    value TEXT NOT NULL,

    -- Content format at the time of the recorded change.
    type TEXT NOT NULL,

    -- Configuration notes at the time of the recorded change.
    description TEXT NOT NULL,

    -- Operation that produced this history entry.
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),

    -- Global revision assigned to the recorded change.
    revision INTEGER NOT NULL,

    -- Display label of the administrator or API token responsible for the change.
    actor TEXT NOT NULL,

    -- UTC timestamp when the change was committed.
    created_at TEXT NOT NULL
);

-- Environment-wide history is listed from the newest revision to the oldest.
CREATE INDEX history_environment_revision ON config_history(environment_id, revision DESC);

-- Key-specific history and version comparison locate revisions of one key.
CREATE INDEX history_key_revision ON config_history(environment_id, key, revision DESC);

-- One durable clock for all configuration changes, including deleted resources.
CREATE TABLE watch_state (
    -- Singleton identifier; the table contains only row 1.
    id INTEGER PRIMARY KEY CHECK (id = 1),

    -- Latest committed global revision shared by all watch scopes.
    revision INTEGER NOT NULL DEFAULT 0,

    -- Last discarded revision; clients below this boundary must reload.
    minimum_revision INTEGER NOT NULL DEFAULT 0,

    -- Unique mutation marker used to guard statements in the same write batch.
    last_mutation TEXT NOT NULL DEFAULT ''
);

INSERT INTO watch_state (id)
VALUES (1);

-- Lightweight invalidations; deliberately omit foreign keys so deletions remain observable.
-- The INTEGER PRIMARY KEY supports revision range reads and retention-prefix deletion.
CREATE TABLE watch_changes (
    -- Committed global revision identifying this change and ordering the log.
    revision INTEGER PRIMARY KEY,

    -- Immutable project identity used to match authorized scopes.
    project_id TEXT NOT NULL,

    -- Public project identifier retained even after the project is deleted.
    project_slug TEXT NOT NULL,

    -- Immutable environment identity; NULL identifies a project-level change.
    environment_id TEXT,

    -- Public environment identifier; NULL identifies a project-level change.
    environment_slug TEXT,

    -- Configuration key; NULL identifies a project or environment change.
    config_key TEXT,

    -- Kind of resource invalidated by this change.
    resource TEXT NOT NULL CHECK (resource IN ('project', 'environment', 'config')),

    -- Operation exposed to watch clients as a change notification.
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'restore')),

    -- UTC commit timestamp used to determine the retention cutoff.
    created_at TEXT NOT NULL
);

-- API tokens are separate from account login sessions.
CREATE TABLE api_keys (
    -- Immutable identifier used to list and delete the API token.
    id TEXT PRIMARY KEY,

    -- Human-readable token name displayed in the console and history.
    name TEXT NOT NULL,

    -- Unique SHA-256 digest of the token; plaintext tokens are never stored.
    token TEXT NOT NULL UNIQUE,

    -- Leading token characters displayed for identification, not authentication.
    prefix TEXT NOT NULL,

    -- Inclusive UTC calendar date in YYYY-MM-DD format; NULL means no expiration.
    expires_at TEXT,

    -- UTC timestamp of the last recorded use; NULL means not yet used.
    last_used_at TEXT,

    -- UTC timestamp when the token was created.
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Resource grants associated with each API token.
CREATE TABLE api_key_scopes (
    -- Unique identifier of this grant.
    id TEXT PRIMARY KEY,

    -- Owning API token; deleting the token removes its grants.
    api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,

    -- Granted project; NULL represents all projects and is exposed as '*' by the API.
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,

    -- Granted environment; NULL represents all environments within the granted project range.
    environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,

    -- Allowed access level; write includes reading and configuration editing.
    permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),

    -- A grant for all projects must also cover all environments.
    CHECK (project_id IS NOT NULL OR environment_id IS NULL)
);

-- Authentication loads grants by token; deleting a token uses the same lookup.
CREATE INDEX scopes_key ON api_key_scopes(api_key_id);
