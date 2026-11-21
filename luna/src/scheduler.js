function createScheduler() {
    const jobs = new Map();

    function addJob(name, intervalMs, fn) {
        const key = String(name);
        if (jobs.has(key)) return jobs.get(key);

        const job = {
            name: key,
            intervalMs: Math.max(1000, Math.floor(Number(intervalMs) || 0)),
            fn,
            timer: null,
            running: false,
            lastRunAt: 0,
            lastErrorAt: 0,
            lastError: null
        };

        const tick = async () => {
            if (job.running) return;
            job.running = true;
            job.lastRunAt = Date.now();
            try {
                await Promise.resolve(fn());
                job.lastError = null;
            } catch (e) {
                job.lastErrorAt = Date.now();
                job.lastError = e;
            } finally {
                job.running = false;
            }
        };

        job.timer = setInterval(tick, job.intervalMs);
        jobs.set(key, job);
        return job;
    }

    function removeJob(name) {
        const key = String(name);
        const job = jobs.get(key);
        if (!job) return false;
        try {
            if (job.timer) clearInterval(job.timer);
        } catch {
        }
        jobs.delete(key);
        return true;
    }

    function listJobs() {
        return [...jobs.values()].map((j) => ({
            name: j.name,
            intervalMs: j.intervalMs,
            running: !!j.running,
            lastRunAt: j.lastRunAt,
            lastErrorAt: j.lastErrorAt,
            lastError: j.lastError ? String(j.lastError && j.lastError.message ? j.lastError.message : j.lastError) : null
        }));
    }

    return { addJob, removeJob, listJobs };
}

module.exports = { createScheduler };
