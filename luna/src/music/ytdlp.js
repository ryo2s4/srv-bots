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

    const url = info && (info.url || (info.requested_downloads && info.requested_downloads[0] && info.requested_downloads[0].url));
    if (!url || !/^https?:\/\//i.test(String(url))) {
        throw new Error('ما لقيت رابط تشغيل مباشر للأغنية 3:');
    }

    return {
        url: String(url),
        title: String((info && info.title) || q).slice(0, 200),
        webpageUrl: String((info && info.webpage_url) || ''),
        durationMs: Math.max(0, Math.floor(Number(info && info.duration) || 0) * 1000)
    };
}

module.exports = { resolveTrack, BIN };
