function errToString(err) {
    try {
        if (!err) return 'unknown';
        if (typeof err === 'string') return err;
        if (err && err.stack) return String(err.stack);
        if (err && err.message) return String(err.message);
        return String(err);
    } catch {
        return 'unknown';
    }
}

function logError(scope, err, extra) {
    try {
        const e = errToString(err);
        if (extra !== undefined) {
            console.error(`[${scope}]`, e, extra);
        } else {
            console.error(`[${scope}]`, e);
        }
    } catch {
        // ignore
    }
}

module.exports = { logError, errToString }; 
