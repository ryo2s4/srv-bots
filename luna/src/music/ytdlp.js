// Resolve a YouTube search/URL into a direct audio stream URL using the
// standalone yt-dlp binary. No download happens — we only ask for metadata.
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const BIN = process.env.YTDLP_PATH || '/home/ryo2s/.local/bin/yt-dlp';

async function resolveTrack(query) {
    const q = String(query == null ? '' : query).trim();
    if (!q) throw new Error('اكتب اسم أغنية أو رابط YouTube 3:');

    const args = [
        '--dump-single-json',
        '--format', 'bestaudio/best',
        '--no-playlist',
        '--default-search', 'ytsearch',
        '--no-warnings',
        '--socket-timeout', '10',
        q
    ];

    let stdout;
    try {
        const result = await run(BIN, args, {
            timeout: 45_000,
            maxBuffer: 8 * 1024 * 1024
        });
        stdout = result.stdout;
    } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if (/ENOENT|not found/i.test(msg)) {
            throw new Error('أداة yt-dlp غير موجودة على السيرفر.');
        }
        throw new Error(`ما قدرت أجيب الأغنية: ${msg.slice(0, 300)}`);
    }

    let info;
    try {
        info = JSON.parse(String(stdout || '').trim());
    } catch {
        throw new Error('استجابة yt-dlp غير صالحة 3:');
    }

    // A plain search (ytsearch:) comes back as a playlist-like object whose
    // first entry is the actual video. A direct URL comes back as the video
    // itself. Normalise both shapes here.
    let picked = info;
    if (picked && Array.isArray(picked.entries) && picked.entries.length) {
        picked = picked.entries.find((e) => e && e.url) || picked.entries[0];
    }
    const url = picked && (picked.url || (picked.requested_downloads && picked.requested_downloads[0] && picked.requested_downloads[0].url));
    if (!url || !/^https?:\/\//i.test(String(url))) {
        throw new Error('ما لقيت رابط تشغيل مباشر للأغنية 3:');
    }

    return {
        url: String(url),
        title: String((picked && picked.title) || q).slice(0, 200),
        webpageUrl: String((picked && picked.webpage_url) || (info && info.webpage_url) || ''),
        thumbnail: String((picked && picked.thumbnail) || (picked && picked.thumbnails && picked.thumbnails[0] && picked.thumbnails[0].url) || ''),
        channel: String((picked && (picked.channel || picked.uploader)) || ''),
        durationMs: Math.max(0, Math.floor(Number(picked && picked.duration) || 0) * 1000)
    };
}

// Turn a video thumbnail into a circular PNG "disc" for the player embed.
async function makeDiscBuffer(thumbnailUrl) {
    const url = String(thumbnailUrl || '');
    if (!/^https?:\/\//i.test(url)) return null;
    const { spawn } = require('child_process');
    const { Readable } = require('stream');
    let ffmpegPath = null;
    try { ffmpegPath = require('ffmpeg-static'); } catch { return null; }
    if (!ffmpegPath) return null;

    const vf = 'scale=256:256:force_original_aspect_ratio=increase,crop=256:256,format=rgba,' +
        'geq=r=r(X\\,Y):g=g(X\\,Y):b=b(X\\,Y):a=if(lte(hypot(X-128\\,Y-128)\\,128)\\,255\\,0)';

    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        try {
            (async () => {
                const resp = await fetch(url, { signal: AbortSignal.timeout(12_000) });
                if (!resp.ok || !resp.body) return finish(null);
                const p = spawn(ffmpegPath, [
                    '-y', '-loglevel', 'error', '-i', 'pipe:0',
                    '-vf', vf, '-frames:v', '1',
                    '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'
                ], { stdio: ['pipe', 'pipe', 'pipe'] });
                const chunks = [];
                p.stdout.on('data', (d) => chunks.push(d));
                p.stderr.on('data', () => {});
                p.on('error', () => finish(null));
                p.on('close', (code) => {
                    const buf = Buffer.concat(chunks);
                    finish(code === 0 && buf.length ? buf : null);
                });
                Readable.fromWeb(resp.body).pipe(p.stdin);
            })().catch(() => finish(null));
        } catch {
            finish(null);
        }
        setTimeout(() => finish(null), 20_000);
    });
}

module.exports = { resolveTrack, makeDiscBuffer, BIN };
