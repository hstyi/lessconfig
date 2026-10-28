import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const storage = mkdtempSync(join(tmpdir(), 'lessconfig-playwright-'));
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
let child;
let stopping = false;

/** Stop the complete Wrangler process tree before removing its isolated database. */
function cleanup() {
    if (stopping) {
        return;
    }

    stopping = true;

    if (child?.pid) {
        try {
            process.kill(-child.pid, 'SIGTERM');
        } catch {
            /* The process already exited. */
        }
    }

    setTimeout(() => {
        rmSync(storage, { recursive: true, force: true });
        process.exit(0);
    }, 500);
}

process.on('SIGTERM', cleanup);

process.on('SIGINT', cleanup);

try {
    // Keep browser tests independent of the developer's optional local environment files.
    const secretsFile = join(storage, '.env');
    writeFileSync(secretsFile, '', { mode: 0o600 });

    execFileSync(
        process.execPath,
        [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', storage, '--config', 'wrangler.jsonc'],
        { stdio: 'pipe' },
    );
    child = spawn(
        process.execPath,
        [
            wrangler,
            'dev',
            '--config',
            'dist/lessconfig/wrangler.json',
            '--env-file',
            secretsFile,
            '--port',
            '4174',
            '--persist-to',
            storage,
            '--local',
            '--inspector-port',
            '0',
        ],
        { detached: true, stdio: 'inherit' },
    );
    child.on('exit', cleanup);
} catch (error) {
    rmSync(storage, { recursive: true, force: true });

    throw error;
}
