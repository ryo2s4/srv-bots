// أزرار الألعاب الترفيهية 🎮 — /trivia و/rps وإغلاق الاستطلاعات
// القواعد: كل الجلسات داخل الذاكرة (Map) · كل لعبة مقفلة على صاحبها ·
// أي جلسة منتهية/غائبة = رسالة ودّية مؤقتة بدون كراش.

const { MessageFlags, ButtonStyle } = require('discord.js');
const UI = require('../utils/ui');

const SESSION_TTL = 10 * 60 * 1000; // 10 دقائق خمول = نهاية الجلسة
const FLASH_MS = 1200;              // وميض صحيح/غلط قبل السؤال التالي

const triviaSessions = new Map();
const rpsSessions = new Map();
const polls = new Map(); // `<guildId>:<messageId>` → بيانات الاستطلاع

const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// ---------- مساعدات عامة ----------

function shortId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clip(text, n = 80) {
    const s = String(text == null ? '' : text);
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function ephReply(interaction, content) {
    return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
}

function later(fn, ms) {
    const t = setTimeout(() => { fn().catch(() => {}); }, ms);
    if (t && typeof t.unref === 'function') t.unref();
    return t;
}

// تنظيف الجلسات المنتهية (يتصل فيه عند كل إنشاء/نقرة — بدون تايمر ثابت)
function sweep() {
    const now = Date.now();
    for (const [k, s] of triviaSessions) if (!s.expiresAt || now > s.expiresAt) triviaSessions.delete(k);
    for (const [k, s] of rpsSessions) if (!s.expiresAt || now > s.expiresAt) rpsSessions.delete(k);
}

// ==================================================================
// 🧠 تريفيا — سؤال/جواب فردي
// ==================================================================

function createTriviaSession({ ownerId, ownerTag, guildId, count }) {
    let pool = [];
    try {
        pool = require('../eventGames').getTriviaPool() || [];
    } catch {
        pool = [];
    }
    if (!Array.isArray(pool) || pool.length === 0) return null;
    sweep();

    const want = Math.max(1, Math.min(Math.floor(Number(count) || 5), 10, pool.length));
    const picked = [];
    const used = new Set();
    while (picked.length < want) {
        const i = Math.floor(Math.random() * pool.length);
        if (used.has(i)) continue;
        used.add(i);
        picked.push(pool[i]);
    }

    const session = {
        id: shortId(),
        ownerId: String(ownerId),
        ownerTag: String(ownerTag || 'لاعب'),
        guildId: guildId ? String(guildId) : null,
        questions: picked,
        index: 0,
        score: 0,
        awaiting: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL
    };
    triviaSessions.set(session.id, session);
    return session;
}

function triviaRows(session, opts, { disabled = false, chosenIdx = -1 } = {}) {
    const buttons = opts.map((opt, i) => UI.btn(`trivia:${session.id}:${i}`, clip(opt, 80), {
        disabled,
        style: disabled
            ? (i === chosenIdx ? ButtonStyle.Success : ButtonStyle.Secondary)
            : ButtonStyle.Secondary
    }));
    return UI.chunk(buttons, 5).map((group) => UI.row(...group));
}

function buildTriviaMessage(session) {
    const q = session.questions[session.index];
    const total = session.questions.length;
    const embed = UI.embed({
        color: UI.COLORS.events,
        title: `🧠 سؤال ${session.index + 1}/${total}`,
        description: `${q.q}\n\n**النتيجة الحالية:** ${session.score} ✅`,
        footerText: session.ownerTag
    });
    return { embeds: [embed], components: triviaRows(session, q.opts) };
}

function rateTrivia(score, total) {
    if (total > 0 && score === total) return 'عبقري 🧠';
    const pct = total > 0 ? score / total : 0;
    if (pct >= 0.8) return 'ما شاء الله عليك! 🌟';
    if (pct >= 0.5) return 'مو بأس أبدًا 👍';
    if (pct >= 0.25) return 'نص ونص… المرة الجاية أفضل 💪';
    return 'المرة الجاية إن شاء الله 😅';
}

function buildTriviaFinal(session) {
    const total = session.questions.length;
    const score = session.score;
    const embed = UI.embed({
        color: score === total ? UI.COLORS.gold : (score >= total / 2 ? UI.COLORS.success : UI.COLORS.muted),
        title: '🏁 انتهى التحدي!',
        description: `النتيجة النهائية: **${score} / ${total}**\n${UI.progressBar(score, total, 12)}\n\n${rateTrivia(score, total)}`,
        footerText: session.ownerTag
    });
    return {
        embeds: [embed],
        components: [UI.disabledEndRow(`trivia:${session.id}:done`, 'انتهى التحدي')]
    };
}

async function advanceTrivia(message, session) {
    if (!triviaSessions.has(session.id)) return;
    session.index++;
    if (session.index >= session.questions.length) {
        triviaSessions.delete(session.id);
        try { await message.edit(buildTriviaFinal(session)); } catch {}
        return;
    }
    session.awaiting = false;
    session.expiresAt = Date.now() + SESSION_TTL;
    try { await message.edit(buildTriviaMessage(session)); } catch {}
}

async function handleTrivia({ interaction }) {
    const parts = interaction.customId.split(':');
    const session = triviaSessions.get(parts[1] || '');

    if (!session) {
        await ephReply(interaction, 'آسف بس، هاللعبة انتهت أو ضاعت بالغلط… ابدأ وحدة جديدة بـ /trivia 3:');
        return true;
    }
    if (String(interaction.user.id) !== session.ownerId) {
        await ephReply(interaction, 'هاللعبة مو لك 3:');
        return true;
    }
    if (session.awaiting) {
        await ephReply(interaction, 'لحظة… خلني أعرض النتيجة أول 😅');
        return true;
    }
    const idx = Number.parseInt(parts[2], 10);
    const q = session.questions[session.index];
    if (!q || !Number.isInteger(idx) || idx < 0 || idx >= q.opts.length) {
        await ephReply(interaction, 'هالزر ما عاد يشتغل 3:');
        return true;
    }

    const correct = String(q.opts[idx]) === String(q.correct);
    if (correct) session.score++;
    session.awaiting = true;
    session.expiresAt = Date.now() + SESSION_TTL;

    const correctIdx = q.opts.findIndex((o) => String(o) === String(q.correct));
    const flash = UI.embed({
        color: correct ? UI.COLORS.success : UI.COLORS.danger,
        title: correct ? '✅ إجابة صحيحة!' : '❌ إجابة خاطئة',
        description: `${q.q}\n\n${correct ? '🎉 **+1 نقطة!**' : `الإجابة الصحيحة: **${q.correct}**`}\n\n**النتيجة:** ${session.score} / ${session.questions.length}`,
        footerText: session.ownerTag
    });

    try {
        await interaction.update({
            embeds: [flash],
            components: triviaRows(session, q.opts, { disabled: true, chosenIdx: correctIdx >= 0 ? correctIdx : idx })
        });
    } catch {}

    const message = interaction.message;
    later(() => advanceTrivia(message, session), FLASH_MS);
    return true;
}

// ==================================================================
// ✊ ورقة، حجر، مقص — أفضل من 3 ضد البوت
// ==================================================================

const RPS = {
    rock: { emoji: '✊', label: 'حجر', beats: 'scissors' },
    paper: { emoji: '📄', label: 'ورقة', beats: 'rock' },
    scissors: { emoji: '✂️', label: 'مقص', beats: 'paper' }
};

function createRpsSession({ ownerId, ownerTag, guildId }) {
    sweep();
    const session = {
        id: shortId(),
        ownerId: String(ownerId),
        ownerTag: String(ownerTag || 'لاعب'),
        guildId: guildId ? String(guildId) : null,
        playerScore: 0,
        botScore: 0,
        rounds: [],
        busy: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL
    };
    rpsSessions.set(session.id, session);
    return session;
}

function randomMove() {
    const keys = Object.keys(RPS);
    return keys[Math.floor(Math.random() * keys.length)];
}

// عدّاد يقرأ نمط اللاعب: يعارض أكثر حركة يكررها
function counterMove(rounds) {
    const counts = {};
    for (const r of rounds) counts[r.player] = (counts[r.player] || 0) + 1;
    let best = null;
    let bestN = 0;
    for (const [move, n] of Object.entries(counts)) {
        if (n > bestN || (n === bestN && Math.random() < 0.5)) {
            best = move;
            bestN = n;
        }
    }
    if (!best) return null;
    return Object.keys(RPS).find((m) => RPS[m].beats === best) || null;
}

function roundWinner(player, bot) {
    if (player === bot) return 'draw';
    return RPS[player].beats === bot ? 'player' : 'bot';
}

function rpsButtons(session, { disabled = false } = {}) {
    return UI.row(...Object.keys(RPS).map((move) =>
        UI.btn(`rps:${session.id}:${move}`, RPS[move].label, { emoji: RPS[move].emoji, disabled })
    ));
}

function buildRpsMessage(session) {
    const embed = UI.embed({
        color: UI.COLORS.events,
        title: '✊ ورقة، حجر، مقص — أفضل من 3',
        description: 'اختر حركتك… أول واحد يوصل **2** يفوز بالمباراة! 🏆\n\n📊 النتيجة: **أنت 0 — البوت 0**',
        footerText: session.ownerTag
    });
    return { embeds: [embed], components: [rpsButtons(session)] };
}

function buildRpsRound(session) {
    const last = session.rounds[session.rounds.length - 1];
    const p = RPS[last.player];
    const b = RPS[last.bot];
    const resultLine = last.winner === 'player'
        ? '🎉 **فزت بالجولة!**'
        : last.winner === 'bot'
            ? '💔 **فزت البوت بالجولة**'
            : '🤝 **تعادل!**';
    const strategyLine = last.read ? '\n\n> **البوت يقرأ نمطك! 🤖**' : '';
    const history = session.rounds.map((r, i) => {
        const pr = RPS[r.player];
        const br = RPS[r.bot];
        const mark = r.winner === 'player' ? '✅' : r.winner === 'bot' ? '❌' : '➖';
        return `${mark} **جولة ${i + 1}:** ${pr.emoji} ${pr.label} ضد ${br.emoji} ${br.label}`;
    }).join('\n');
    const scoreLine = `📊 النتيجة: **أنت ${session.playerScore} — البوت ${session.botScore}**`;
    const done = session.playerScore >= 2 || session.botScore >= 2;

    if (done) {
        const won = session.playerScore >= 2;
        const embed = UI.embed({
            color: won ? UI.COLORS.success : UI.COLORS.danger,
            title: won ? '🏆 فزت بالمباراة!' : '💔 فاز البوت بالمباراة',
            description: `${history}\n\n${scoreLine}\n\n${won ? '👏 عليك! البوت ما قدر عليك.' : '😤 المرة الجاية تكسره إن شاء الله!'}${strategyLine}`,
            footerText: session.ownerTag
        });
        return { embeds: [embed], components: [rpsButtons(session, { disabled: true })], done };
    }

    const embed = UI.embed({
        color: UI.COLORS.events,
        title: `⚔️ الجولة ${session.rounds.length}`,
        description: `أنت: ${p.emoji} ${p.label} · البوت: ${b.emoji} ${b.label}\n${resultLine}${strategyLine}\n\n${history}\n\n${scoreLine}`,
        footerText: session.ownerTag
    });
    return { embeds: [embed], components: [rpsButtons(session)], done: false };
}

async function handleRps({ interaction }) {
    const parts = interaction.customId.split(':');
    const session = rpsSessions.get(parts[1] || '');
    const move = parts[2] || '';

    if (!session) {
        await ephReply(interaction, 'آسف بس، هاللعبة انتهت… ابدأ وحدة جديدة بـ /rps 3:');
        return true;
    }
    if (String(interaction.user.id) !== session.ownerId) {
        await ephReply(interaction, 'هاللعبة مو لك 3:');
        return true;
    }
    if (!RPS[move]) {
        await ephReply(interaction, 'هالزر ما عاد يشتغل 3:');
        return true;
    }
    if (session.busy) {
        await ephReply(interaction, 'لحظة… أحسب الجولة 😅');
        return true;
    }

    session.busy = true;
    try {
        session.expiresAt = Date.now() + SESSION_TTL;

        // الاستراتيجية: 50% عشوائي، 50% يعارض أكثر حركة تكرارًا عندك
        let botMove = randomMove();
        let read = false;
        if (Math.random() < 0.5) {
            const counter = counterMove(session.rounds);
            if (counter) {
                botMove = counter;
                read = true;
            }
        }

        const winner = roundWinner(move, botMove);
        session.rounds.push({ player: move, bot: botMove, winner, read });
        if (winner === 'player') session.playerScore++;
        else if (winner === 'bot') session.botScore++;

        const payload = buildRpsRound(session);
        try {
            await interaction.update(payload);
        } catch {}
        if (payload.done) rpsSessions.delete(session.id);
    } finally {
        session.busy = false;
    }
    return true;
}

// ==================================================================
// 📊 استطلاعات — عدّ الأصوات وإغلاق الاستطلاع
// ==================================================================

function registerPoll({ client, guildId, channelId, messageId, ownerId, ownerTag, question, choices, durationMs, pollId }) {
    const key = `${guildId || ''}:${messageId}`;
    const entry = {
        ownerId: String(ownerId),
        ownerTag: String(ownerTag || ''),
        question: String(question || ''),
        choices: (Array.isArray(choices) ? choices : []).map(String),
        closesAt: durationMs ? Date.now() + Number(durationMs) : null,
        pollId: String(pollId || ''),
        channelId: channelId ? String(channelId) : null,
        messageId: String(messageId),
        timer: null
    };
    if (durationMs && client) {
        entry.timer = later(() => closePollByTimer(client, key), Number(durationMs));
    }
    polls.set(key, entry);
    return entry;
}

// عدّ الأصوات: تجاهل رد البوت على كل خيار
function tallyVotes(message, choices) {
    return choices.map((_, i) => {
        let reaction = null;
        try {
            reaction = message.reactions.cache.find((r) => r.emoji && r.emoji.name === numberEmojis[i]);
        } catch {
            reaction = null;
        }
        if (!reaction) return 0;
        let n = Number(reaction.count) || 0;
        if (reaction.me) n -= 1;
        return Math.max(0, n);
    });
}

function buildPollResults(record, message) {
    const counts = tallyVotes(message, record.choices);
    const total = counts.reduce((a, b) => a + b, 0);
    const max = Math.max(0, ...counts);
    const lines = record.choices.map((choice, i) => {
        const votes = counts[i] || 0;
        const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
        const trophy = max > 0 && votes === max ? '🏆 ' : '';
        return `${trophy}${numberEmojis[i]} **${choice}**\n${UI.progressBar(votes, Math.max(total, 1), 12)} **${pct}%** · ${UI.fmtNum(votes)} صوت`;
    }).join('\n\n');

    return UI.embed({
        color: UI.COLORS.gold,
        title: `📊 نتائج: ${record.question}`,
        description: total > 0 ? lines : `ما صوّت أحد 😅\n\n${record.choices.map((c, i) => `${numberEmojis[i]} ${c}`).join('\n')}`,
        footerText: 'انتهى التصويت'
    });
}

async function closePollByTimer(client, key) {
    const record = polls.get(key);
    if (!record) return;
    polls.delete(key);
    try {
        const channel = await client.channels.fetch(record.channelId);
        const message = await channel.messages.fetch(record.messageId);
        await message.edit({ embeds: [buildPollResults(record, message)], components: [] });
    } catch {}
}

async function handlePoll({ interaction }) {
    const parts = interaction.customId.split(':'); // poll:close:<ownerId>:<pollId>
    const sub = parts[1] || '';

    if (sub !== 'close') {
        await ephReply(interaction, 'هالزر ما عاد يشتغل 3:');
        return true;
    }

    const key = `${interaction.guild ? interaction.guild.id : ''}:${interaction.message ? interaction.message.id : ''}`;
    const record = polls.get(key);
    if (!record || record.pollId !== (parts[3] || '')) {
        await ephReply(interaction, 'هالتصويت مسكّر أو انتهى… ما عاد ينُعد 3:');
        return true;
    }
    if (String(interaction.user.id) !== record.ownerId) {
        await ephReply(interaction, 'هالتصويت مو لك 3:');
        return true;
    }

    if (record.timer) clearTimeout(record.timer);
    polls.delete(key);

    let message = interaction.message;
    try {
        message = await interaction.channel.messages.fetch(interaction.message.id);
    } catch {}

    try {
        await interaction.update({ embeds: [buildPollResults(record, message)], components: [] });
    } catch {}
    return true;
}

// ==================================================================
// الموجّه
// ==================================================================

async function handle({ client, interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    const id = typeof interaction.customId === 'string' ? interaction.customId : '';
    if (id.startsWith('trivia:')) return handleTrivia({ client, interaction });
    if (id.startsWith('rps:')) return handleRps({ client, interaction });
    if (id.startsWith('poll:')) return handlePoll({ client, interaction });
    return false;
}

module.exports = {
    handle,
    createTriviaSession,
    buildTriviaMessage,
    createRpsSession,
    buildRpsMessage,
    registerPoll
};
