// Temp data-dir helper for tests that need scratch storage.
//
// TEST ISOLATION RULE: tests must never touch the real `data/` directory.
// `src/db.js` currently hardcodes `path.join(__dirname, '..', 'data')`, but it
// may gain `LUNA_TEST_DATA_DIR` env support. This helper creates a unique
// scratch directory per test run and hands back the env override to apply when
// that support lands. Until then, store-dependent tests must run against the
// in-memory stubs in `tests/helpers/stubStore.js` instead of the real stores.
//
// Layout: /tmp/opencode/luna-tests-<pid>/<prefix>-XXXXXX

const fs = require('fs');
const path = require('path');

const RUN_ROOT = path.join('/tmp/opencode', `luna-tests-${process.pid}`);

function ensureRunRoot() {
    fs.mkdirSync(RUN_ROOT, { recursive: true });
    return RUN_ROOT;
}

/** Create a unique scratch directory inside the per-run root. */
function createTempDataDir(prefix = 'data') {
    ensureRunRoot();
    return fs.mkdtempSync(path.join(RUN_ROOT, `${prefix}-`));
}

/** Env overrides to apply to a child process that honors LUNA_TEST_DATA_DIR. */
function makeTempDataEnv(dir) {
    return { LUNA_TEST_DATA_DIR: dir };
}

/** Remove a single scratch directory (never throws). */
function cleanupTempDir(dir) {
    if (!dir || !String(dir).startsWith(RUN_ROOT)) return; // refuse wild deletes
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // best effort
    }
}

/** Remove the whole per-run root (never throws). Call from an after() hook. */
function cleanupRunRoot() {
    try {
        fs.rmSync(RUN_ROOT, { recursive: true, force: true });
    } catch {
        // best effort
    }
}

module.exports = {
    RUN_ROOT,
    createTempDataDir,
    makeTempDataEnv,
    cleanupTempDir,
    cleanupRunRoot
};
