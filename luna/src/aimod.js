const { getGuildConfig } = require('./guildConfig');
const http = require('http');
const https = require('https');

// Cache for recent analysis to avoid spamming AI
const analysisCache = new Map();
const CACHE_TTL = 5000; // 5 seconds

function normalizeArabic(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // harakat
        .replace(/\u0640/g, '') // tatweel
        .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation to space
        .replace(/\s+/g, ' ')
        .trim();
}

function hasAnyWord(text, words) {
    if (!text) return false;
    for (const w of words) {
        if (!w) continue;
        if (text.includes(w)) return true;
    }
    return false;
}

function matchesAnyPattern(text, patterns) {
    if (!text) return false;
    for (const re of patterns) {
        try {
            if (re.test(text)) return true;
        } catch {
            // ignore
        }
    }
    return false;
}

function quickClassifyLocal(content) {
    const t = normalizeArabic(content);
    if (!t) return null;

    // Safe words / phrases that should never be punished by AI mod when alone.
    // (They may be used in arguments, but you asked to not punish them unless combined with severe profanity.)
    const safePatterns = [
        /(^|\s)مثقفه(\s|$)/,
        /(^|\s)امك(\s|$)/
    ];

    if (matchesAnyPattern(t, safePatterns)) {
        return { toxic: false, severity: 'none', type: 'none', action: 'none' };
    }

    // These are explicitly ignored (mild insults / normal slang)
    const mild = [
        'حيوان',
        'كلب',
        'كلتبن',
        'غبي',
        'تافه',
        'حقير',
        'ساقط',
        'موت'
    ];

    // These are punished (heavy profanity / sexual harassment / honor attacks)
    // Use patterns to avoid false positives (e.g., "كس" inside normal words).
    const severePatterns = [
        /(^|\s)كسم(\s|$)/,
        /(^|\s)اير(\s|$)/,
        /(^|\s)عير(\s|$)/,
        /(^|\s)نيك(\s|$)/,
        /(^|\s)نيج(\s|$)/,
        /(^|\s)انيك(\s|$)/,
        /(^|\s)انيج(\s|$)/,
        /(^|\s)كسخ(\s|$)/,
        /(^|\s)كسخت(\s|$)/,
        /(^|\s)عاهره(\s|$)/,
        /(^|\s)قحبه(\s|$)/,
        /(^|\s)سكس(\s|$)/,
        // standalone "كس" only when it's a separate word
        /(^|\s)كس(\s|$)/
    ];

    const hasSevere = matchesAnyPattern(t, severePatterns);
    if (hasSevere) {
        // Classify as high so it crosses medium threshold.
        return { toxic: true, severity: 'high', type: 'severe_profanity', action: 'timeout' };
    }

    const hasMild = hasAnyWord(t, mild);
    if (hasMild) {
        // Explicitly ignore mild insults
        return { toxic: false, severity: 'none', type: 'none', action: 'none' };
    }

    return null;
}

function getAiModConfig(guildId) {
    const cfg = getGuildConfig(guildId);
    const aiMod = cfg.aiMod && typeof cfg.aiMod === 'object' ? cfg.aiMod : {};
    return {
        enabled: aiMod.enabled === true,
        action: ['delete', 'timeout', 'ban'].includes(aiMod.action) ? aiMod.action : 'delete',
        timeoutMinutes: Math.max(1, Math.floor(Number(aiMod.timeoutMinutes) || 10)),
        threshold: ['low', 'medium', 'high'].includes(aiMod.threshold) ? aiMod.threshold : 'medium',
        logChannelId: typeof aiMod.logChannelId === 'string' ? aiMod.logChannelId : null,
        ignoreChannelIds: Array.isArray(aiMod.ignoreChannelIds) ? aiMod.ignoreChannelIds : [],
        ignoreRoleIds: Array.isArray(aiMod.ignoreRoleIds) ? aiMod.ignoreRoleIds : []
    };
}

function shouldSkip(message, config) {
    if (!config.enabled) return true;
    if (message.author.bot) return true;
    if (!message.content || message.content.length < 3) return true;
    
    // Check ignored channels
    if (config.ignoreChannelIds.includes(message.channel.id)) return true;
    
    // Check ignored roles
    if (message.member && message.member.roles) {
        for (const roleId of config.ignoreRoleIds) {
            if (message.member.roles.cache.has(roleId)) return true;
        }
    }
    
    // Skip admins
    if (message.member && message.member.permissions) {
        if (message.member.permissions.has('Administrator')) return true;
        if (message.member.permissions.has('ModerateMembers') && config.action === 'ban') return true;
    }
    
    return false;
}

async function analyzeContent(content, baseUrl, model) {
    // Check cache first
    const cacheKey = content.slice(0, 100);
    const cached = analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.result;
    }

    const local = quickClassifyLocal(content);
    if (local) {
        analysisCache.set(cacheKey, { result: local, ts: Date.now() });
        return local;
    }
    
    const prompt = `You are a STRICT but CONSERVATIVE Arabic moderation classifier.
Only flag SEVERE profanity / sexual harassment / honor attacks / hate speech / direct threats.
Do NOT flag normal conversation or mild insults.

Important Arabic edge cases:
- The word "امك" alone is NOT a violation. Only flag if combined with severe profanity (e.g., "كسم امك").
- Words like "مثقفة" are NOT violations.
 
Message: "${content.replace(/"/g, '\\"').slice(0, 500)}"

Respond with ONLY a JSON object (no other text):
{
  "toxic": true/false,
  "severity": "none" or "low" or "medium" or "high" or "critical",
  "type": "none" or "severe_profanity" or "sexual_harassment" or "honor_attack" or "hate_speech" or "threat",
  "action": "none" or "delete" or "timeout" or "ban"
}

SEVERE profanity (punish):
- Sexual organs/references: كسم، كس، اير، عير، كسختك، كسخ
- Sexual acts: انيج، انيك، نيك
- Family insults involving sexual content: كسم امك، كسخت امك
- Honor attacks / prostitution slurs: عاهرة، قحبة (treat as MEDIUM or HIGH)
- Hate speech, threats, racial slurs

MILD insults (IGNORE - do not punish):
- حيوان، كلب، غبي، تافه، حقير، موت
- Generic insults without sexual/family content

IMPORTANT:
- If unsure, set toxic=false.
- Mild insults must be toxic=false.

JSON:`;

    const result = await callOllama(baseUrl, model, prompt);
    
    // Cache the result
    analysisCache.set(cacheKey, { result, ts: Date.now() });
    
    return result;
}

async function callOllama(baseUrl, model, prompt) {
    const url = `${baseUrl}/api/generate`;
    const body = {
        model: model || 'phi3:mini',
        prompt: prompt,
        stream: false,
        options: {
            temperature: 0.1,
            num_predict: 150
        }
    };
    
    return new Promise((resolve, reject) => {
        let u;
        try {
            u = new URL(url);
        } catch (e) {
            return resolve({ toxic: false, severity: 'none', type: 'error', action: 'none' });
        }
        
        const data = Buffer.from(JSON.stringify(body), 'utf8');
        const lib = u.protocol === 'https:' ? https : http;
        
        const req = lib.request({
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            },
            timeout: 3000
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    const json = JSON.parse(raw);
                    const response = json.response || '';
                    
                    // Parse JSON from response
                    const jsonMatch = response.match(/\{[^{}]*\}/s);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        resolve({
                            toxic: parsed.toxic === true,
                            severity: parsed.severity || 'none',
                            type: parsed.type || 'none',
                            action: parsed.action || 'none'
                        });
                    } else {
                        resolve({ toxic: false, severity: 'none', type: 'parse_error', action: 'none' });
                    }
                } catch (e) {
                    resolve({ toxic: false, severity: 'none', type: 'parse_error', action: 'none' });
                }
            });
        });
        
        req.on('error', () => resolve({ toxic: false, severity: 'none', type: 'error', action: 'none' }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ toxic: false, severity: 'none', type: 'timeout', action: 'none' });
        });
        
        req.write(data);
        req.end();
    });
}

function shouldAct(analysis, config) {
    if (!analysis.toxic) return false;
    
    const severityLevels = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    const thresholdLevels = { low: 1, medium: 2, high: 3 };
    
    const severity = severityLevels[analysis.severity] || 0;
    const threshold = thresholdLevels[config.threshold] || 2;
    
    return severity >= threshold;
}

function determineAction(analysis, config) {
    if (analysis.action === 'ban' && analysis.severity === 'critical') return 'ban';
    if (analysis.action === 'timeout' || analysis.severity === 'high') return 'timeout';
    return config.action || 'delete';
}

// Clean old cache entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of analysisCache.entries()) {
        if (now - value.ts > CACHE_TTL * 10) {
            analysisCache.delete(key);
        }
    }
}, 60000);

module.exports = {
    getAiModConfig,
    shouldSkip,
    analyzeContent,
    shouldAct,
    determineAction
};
