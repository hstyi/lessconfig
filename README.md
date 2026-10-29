<p align="center">
  <img src="./public/favicon.svg" alt="Lessconfig logo" width="80" height="80" />
</p>

<h1 align="center">Lessconfig</h1>

<p align="center">
  A lightweight configuration center built on Cloudflare Workers.
</p>

<p align="center">
  <a href="https://workers.cloudflare.com/"><img src="https://img.shields.io/badge/Powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white" alt="Powered by Cloudflare" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-2ea44f" alt="License: Apache 2.0" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#visual-quick-deploy">Deploy</a> ·
  <a href="#api-usage">API Usage</a> ·
  <a href="#local-development">Development</a> ·
  <a href="https://github.com/lessconfig/lessconfig/issues">Issues</a>
</p>

Organize application settings by **project → environment → key**. Store a simple boolean or a complete configuration file, edit it in the web console, and notify applications through HTTP long polling. Each deployment has one administrator and runs on Cloudflare Workers, D1, KV, and Durable Objects.

---

## Features

| Feature                   | Details                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Projects and environments | Separate configuration by application and deployment environment.                       |
| Configuration formats     | Text, boolean, number, JSON, YAML, and properties files.                                |
| Code editor               | Syntax highlighting and validation, with original content and formatting preserved.     |
| Version history           | Inspect changes, compare versions, and restore previous content.                        |
| Live updates              | GET long polling with scoped subscriptions and a global revision.                       |
| API tokens                | Read or Edit permissions scoped to projects and environments, with optional expiration. |
| Import and export         | Transfer configuration as JSON for one environment or the whole workspace.              |
| Bulk actions              | Select and delete multiple configuration entries.                                       |
| Internationalization      | English and Simplified Chinese, with browser language detection.                        |
| Web console               | A responsive interface built with Cloudflare Kumo and Tailwind CSS.                     |

The console and application clients use the same versioned HTTP API. Project and environment management, account settings, and API token management require an administrator session.

---

## Visual quick deploy

1. Fork [lessconfig/lessconfig](https://github.com/lessconfig/lessconfig/fork) into your GitHub account.
2. Open [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create) and create a Worker connected to your fork.
3. Use `lessconfig` as the Worker name, or update `name` in `wrangler.jsonc` to match your chosen name.
4. Set the **Deploy command** to `npm run deploy`, leave the **Build command** empty, and deploy.
5. Wait for the complete deployment, including database migrations, then open the generated Workers URL.

| Setting        | Value                                                 |
| -------------- | ----------------------------------------------------- |
| Root directory | Repository root                                       |
| Build command  | Leave empty; `npm run deploy` includes the build step |
| Deploy command | `npm run deploy`                                      |

The deployment token needs permission to deploy Workers and edit D1 and Workers KV resources in the target account. See [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) for build settings and token configuration.

> [!IMPORTANT]
> The initial username and password are both **`admin`**. Change the password in **Settings → Account Settings** after signing in.

### Resources and bindings

The shared configuration intentionally omits account-specific resource IDs. [Wrangler provisions the resources](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/) in each deployer's own account and reuses the bindings on subsequent deployments of the same Worker.

| Resource        | Binding    | Purpose                                                                                  |
| --------------- | ---------- | ---------------------------------------------------------------------------------------- |
| D1              | `DB`       | Projects, environments, configuration, version history, accounts, and API token records. |
| Workers KV      | `SESSIONS` | Login sessions with automatic expiration.                                                |
| Durable Objects | `WATCH`    | Coordinate configuration writes and wake waiting clients.                                |

The default D1 database name is `lessconfig`; the default automatically created KV name is `lessconfig-sessions`. Interactive CLI deployment can also prompt you to select an existing KV namespace or choose a new name. Durable Objects are created through the configured Wrangler migration.

If your account already uses these resource names for another application, choose a different Worker name and `database_name` before deploying. Keep any IDs written back by Wrangler in your own deployment configuration rather than committing them to the shared template.

No `JWT_SECRET` or application signing key is required.

## CLI deploy

Use Node.js 24 and npm for the commands below.

```sh
git clone https://github.com/lessconfig/lessconfig.git
cd lessconfig

npm ci
npx wrangler login
npm run deploy
```

`npm run deploy` builds the frontend and Worker, deploys them, and applies the remote D1 migrations. It initializes the administrator on first deployment; subsequent migrations do not reset an existing password.

To use a custom domain, add it under your Worker's **Settings → Domains & Routes** in the Cloudflare dashboard.

---

## API usage

Create a project and environment in the console, then create an API token under **Settings → API Tokens**. Give the token **Read** access for clients that only fetch configuration and watch for updates; **Edit** also permits configuration writes and deletions.

The examples below use a project named `my-app` and an environment named `production`. Replace the URL and token with your own values.

```sh
export LESSCONFIG_URL="https://your-worker.workers.dev"
export LESSCONFIG_TOKEN="your-api-token"
```

### Read configuration

```sh
# List every configuration entry, including its content.
curl "$LESSCONFIG_URL/api/v1/projects/my-app/environments/production/configurations" \
  -H "Authorization: Bearer $LESSCONFIG_TOKEN"

# Fetch a configuration file as its original UTF-8 content.
curl "$LESSCONFIG_URL/api/v1/projects/my-app/environments/production/configurations/application.yml/raw" \
  -H "Authorization: Bearer $LESSCONFIG_TOKEN"
```

The `/raw` endpoint returns `Content-Disposition: inline` by default. Append `?download=1` to return `attachment` and download the file with the configuration key as its filename.

List responses use `{ "items": [...], "total": ... }` and return all records without pagination. API errors use `{ "code": "...", "message": "..." }`, with messages in English.

### Watch for changes

To keep a local configuration cache in sync, initialize watch **before** reading the configuration:

1. Call watch without `revision` to receive the current global revision immediately.
2. Read and apply configuration for the selected scopes.
3. Start a long poll using that saved revision and the same scopes.
4. When changes arrive, reload and apply the affected configuration, save the revision from that watch response, and poll again.

```sh
# Initialize before your first configuration read.
curl "$LESSCONFIG_URL/api/v1/watch?scopes=my-app/production" \
  -H "Authorization: Bearer $LESSCONFIG_TOKEN"

# After reading configuration, pass the revision returned above.
curl "$LESSCONFIG_URL/api/v1/watch?scopes=my-app/production&revision=<REVISION>&timeout=60" \
  -H "Authorization: Bearer $LESSCONFIG_TOKEN" \
  --max-time 90
```

Watch returns `{ "revision": ..., "changes": [...] }`. A poll returns when a matching change is available or the timeout expires. `timeout` defaults to 60 seconds and supports 1–300 seconds; set your client's HTTP timeout longer than the requested wait.

| Scope                               | What it watches                                          |
| ----------------------------------- | -------------------------------------------------------- |
| `my-app`                            | Configuration across all environments in the project.    |
| `my-app/production`                 | All configuration in one environment.                    |
| `my-app/production/application.yml` | One configuration key.                                   |
| `*`                                 | Everything the current credential is authorized to read. |

For multiple scopes, repeat the query parameter: `?scopes=my-app/production&scopes=another-app/staging`. Use `*` on its own. The administrator can watch everything; API tokens remain limited to their grants.

An empty `changes` array means the poll timed out without a matching change: save the returned revision and continue. For nonempty changes, advance the revision only after successfully applying the refreshed configuration. On `410 revision_expired` or `409 revision_ahead`, initialize watch again before reloading. Reinitialize when changing scopes. Use the revision returned by watch, not an individual configuration's revision.

The console's **Integration Guide** provides examples for your selected project and environment.

---

## FAQ

**Does Lessconfig support multiple users?**

Each deployment starts with one administrator. There is no registration or user management interface. Use scoped API tokens for application access. API tokens can access project resources and watch, but cannot manage accounts, tokens, projects, or environments.

**Can I store a complete YAML or JSON file?**

Yes. A key such as `application.yml` can contain an entire file. JSON and YAML are validated on save, with whitespace and YAML comments preserved. Use the `/raw` endpoint to retrieve the original text.

**How are login sessions stored?**

Sessions are stored in Workers KV and expire after seven days. The browser uses an HttpOnly cookie. Changing the password invalidates all existing login sessions; API tokens are unaffected. KV is eventually consistent, so session deletion during logout does not guarantee immediate revocation at every location. See [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

**Are change history and watch events kept forever?**

Configuration version history is retained while its environment exists. Watch events are a separate log: a scheduled Worker removes events older than seven days using the cron schedule `0 0 */3 * *` (00:00 UTC on days 1, 4, 7, and so on each month). Clients whose revisions have expired must reinitialize and reload their configuration.

**What does a workspace export include?**

Projects, environments, and configuration values. Passwords, login sessions, API tokens, and version history are excluded. Import matches projects and environments by their identifiers and updates matching keys; entries missing from the import file are left in place.

---

## How to update

The console directly checks the latest stable release from `lessconfig/lessconfig` on GitHub when the signed-in layout loads. Results are not cached; refreshing the page checks again. When its `x.y.z` tag is newer than the deployed version, a **New version** button appears beside the account menu. Open it to read the release notes and follow the link to that release. This is a notification only; updates are deployed manually.

The deployed version comes from `package.json` at build time. Before publishing a release, set its `version` to match the release tag (for example, `1.2.3`), commit the change, and build from that commit. Drafts, prereleases, and tags outside the `x.y.z` format are ignored. Failed GitHub checks do not interrupt the console.

For a GitHub-connected deployment, sync your fork with the upstream repository and let Workers Builds deploy the updated branch.

For a CLI deployment:

```sh
git pull --ff-only
npm ci
npm run deploy
```

Keep the Worker and resource bindings associated with your existing deployment. Export your configuration before an upgrade and review any release-specific migration instructions.

## Local development

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. The development command applies local D1 migrations before starting the app. D1, KV, and Durable Objects use local storage under `.wrangler/state`; cloud credentials are not required for the default local setup.

| Command                | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `npm run build`        | Type-check and build the frontend and Worker.                  |
| `npm run typecheck`    | Check application and test TypeScript types.                   |
| `npm run lint`         | Run Oxlint.                                                    |
| `npm run format:check` | Check formatting with Oxfmt.                                   |
| `npm run test`         | Run Worker integration tests with Vitest.                      |
| `npm run test:ui`      | Build and run Playwright tests for desktop and mobile layouts. |
| `npm run cf-typegen`   | Regenerate Worker types after changing bindings.               |

Before running UI tests for the first time, install the browser with `npx playwright install chromium`.

---

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
