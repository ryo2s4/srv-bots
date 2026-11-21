// منطق لعب الفعاليات 🎮
// القواعد: أول جواب صح يفوز وتفتح الفعالية فورًا · الغلط = خروج بدون إعادة ·
// اللي عليه كولداون فوز ما يقدر يلعب · الجواب يُتحقق من meta (مو من custom_id).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const eventGames = require('../eventGames');

const eventsWinLocks = new Map();

const shopCooldownMs = {
    event_win: 10 * 60 * 1000
};

function canUseCooldown(guildId, userId, key) {
    const { getGuildShop, updateGuildShop } = require('../shopStore');
    const shop = getGuildShop(guildId);
    const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
    const now = Date.now();
    const last = cd[key] || 0;
    const wait = shopCooldownMs[key] || 0;
    if (now - last < wait) return false;
    updateGuildShop(guildId, (g) => {
        const next = { ...g };
        next.cooldowns = next.cooldowns || {};
        next.cooldowns[userId] = { ...(next.cooldowns[userId] || {}), [key]: now };
        return next;
    });
    return true;
}

function cooldownRemainingMs(guildId, userId, key) {
    try {
        const { getGuildShop } = require('../shopStore');
        const shop = getGuildShop(guildId);
        const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
        const now = Date.now();
        const last = cd[key] || 0;
        const wait = shopCooldownMs[key] || 0;
        const rem = wait - (now - last);
        return rem > 0 ? rem : 0;
    } catch {
        return 0;
    }
}

async function getTotalLunaMultiplier(guildId, userId, cfg, client) {
    const { getUserInventory } = require('../shopStore');
    const { getActiveLunaMultiplier } = require('../boostMeta');
    const { getEquippedRuneMultiplier } = require('../runes');
    const inv = getUserInventory(guildId, userId);
    const itemMult = getActiveLunaMultiplier(inv && Array.isArray(inv.activeBoosts) ? inv.activeBoosts : []);
    const roleBoosts = Array.isArray(cfg.roleBoosts) ? cfg.roleBoosts : [];
    let roleMult = 1;
    try {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
                const memberRoles = [...member.roles.cache.keys()];
                for (const rb of roleBoosts) {
                    if (rb && rb.roleId && memberRoles.includes(rb.roleId) && typeof rb.type === 'string' && rb.type.startsWith('luna_boost') && rb.multiplier > 1) {
                        roleMult *= rb.multiplier;
                    }
                }
            }
        }
    } catch {
        // ignore
    }
    const equippedRuneIds = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
    const allRunes = Array.isArray(inv.runes) ? inv.runes : [];
    const equippedRunes = allRunes.filter((r) => r && equippedRuneIds.includes(r.id));
    const runeMult = getEquippedRuneMultiplier(equippedRunes, 'luna_boost');
    return itemMult * roleMult * runeMult;
}

function disabledEndRow(label = 'انتهت') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('event:ended').setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(true)
    );
}

function clearActive(guildId) {
    const { updateGuildConfig } = require('../guildConfig');
    updateGuildConfig(guildId, (c) => ({
        ...c,
        events: {
            ...(c.events && typeof c.events === 'object' ? c.events : {}),
            active: null
        }
    }));
}

function recordHistory(guildId, active, { type, result, winners, reward, meta = {} }) {
    try {
        const { addEventHistory } = require('../db');
        addEventHistory(guildId, {
            createdAt: Date.now(),
            type: String(type || active.type || 'unknown'),
            reward: Math.max(0, Math.floor(Number(reward) || 0)),
            winners: Array.isArray(winners) ? winners : [],
            channelId: active.channelId ? String(active.channelId) : null,
            messageId: active.messageId ? String(active.messageId) : null,
            meta: { result, ...meta }
        });
    } catch {
    }
}

async function handleEventButton({ client, interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('event:'))) return false;
    if (!interaction.guild) return true;

    const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
    const { addLunaPoints } = require('../levelsStore');

    const reply = async (payload) => {
        try {
            if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
        } catch {
        }
        try {
            return await interaction.reply({ ...payload, ephemeral: true });
        } catch {
            return;
        }
    };

    const parts = interaction.customId.split(':');
    const sub = parts[1] || '';
    if (sub === 'pad' || sub === 'ended') return true;

    const cfg0 = getGuildConfig(interaction.guild.id);
    const e = cfg0.events && typeof cfg0.events === 'object' ? cfg0.events : {};
    let active = e.active && typeof e.active === 'object' ? e.active : null;
    const now = Date.now();

    if (!active || !active.messageId || String(active.messageId) !== String(interaction.message?.id || '')) {
        await reply({ content: 'هالفعالية مو متاحة (يمكن انتهت) 3:' });
        return true;
    }
    if (active.until && now >= Number(active.until)) {
        await reply({ content: 'فاتك… الفعالية انتهت 😅' });
        return true;
    }

    // اللي عليه كولداون فوز = ما يقدر يلعب نهائياً بهالفعالية
    const rem = cooldownRemainingMs(interaction.guild.id, interaction.user.id, 'event_win');
    if (rem > 0) {
        const mins = Math.max(1, Math.ceil(rem / 60000));
        await reply({ content: `⏳ عليك كولداون فوز… انتظر تقريبًا **${mins} دقيقة** قبل ما تشارك بالفعاليات.` });
        return true;
    }

    // اللي غلط = خرج، بدون إعادة 👋
    let eliminated = Array.isArray(active.eliminated) ? active.eliminated.map(String) : [];
    if (eliminated.includes(String(interaction.user.id))) {
        await reply({ content: '❌ أنت خرجت من هالفعالية (جواب غلط) — ما فيه إعادة. انتظر الفعالية الجاية!' });
        return true;
    }

    const lockKey = `${interaction.guild.id}:${active.messageId || interaction.message?.id || ''}`;
    if (eventsWinLocks.get(lockKey)) {
        await reply({ content: 'لحظة…' });
        return true;
    }
    eventsWinLocks.set(lockKey, true);

    try {
        // إعادة قراءة الحالة بعد القفل (منع سباقات النقرات المتزامنة)
        const cfgFresh = getGuildConfig(interaction.guild.id);
        const eFresh = cfgFresh.events && typeof cfgFresh.events === 'object' ? cfgFresh.events : {};
        active = eFresh.active && typeof eFresh.active === 'object' ? eFresh.active : null;
        if (!active || !active.messageId || String(active.messageId) !== String(interaction.message?.id || '')) {
            await reply({ content: 'هالفعالية انتهت 3:' });
            return true;
        }
        eliminated = Array.isArray(active.eliminated) ? active.eliminated.map(String) : [];
        if (eliminated.includes(String(interaction.user.id))) {
            await reply({ content: '❌ أنت خرجت من هالفعالية (جواب غلط) — ما فيه إعادة.' });
            return true;
        }
        const cfg = cfgFresh;

        const reward = Math.max(0, Math.floor(Number(active.reward) || 0));

        // ===== الفوز المشترك: أول جواب صح = نهاية الفعالية =====
        const finalizeWin = async ({ type, meta = {} }) => {
            canUseCooldown(interaction.guild.id, interaction.user.id, 'event_win');
            let finalReward = reward;
            try {
                const lunaMult = await getTotalLunaMultiplier(interaction.guild.id, interaction.user.id, cfg, interaction.client);
                finalReward = Math.max(1, Math.floor(reward * lunaMult));
                addLunaPoints(interaction.guild.id, interaction.user.id, finalReward);
            } catch {
            }

            try {
                const dailyCmd = client.commands.get('daily');
                if (dailyCmd && typeof dailyCmd.dayKeyUtc === 'function') {
                    const { getDailyTasksEntry, setDailyTasksEntry } = require('../db');
                    const dk = dailyCmd.dayKeyUtc();
                    const entry = getDailyTasksEntry(interaction.guild.id, interaction.user.id, dk);
                    const progress = entry && entry.progress && typeof entry.progress === 'object' ? entry.progress : {};
                    const next = { ...progress };
                    next.win_event_1 = Math.max(0, Math.floor(Number(next.win_event_1) || 0)) + 1;
                    setDailyTasksEntry(interaction.guild.id, interaction.user.id, dk, {
                        progress: next,
                        claimedAt: entry && entry.claimedAt ? entry.claimedAt : 0,
                        updatedAt: Date.now()
                    });
                }
            } catch {
            }

            recordHistory(interaction.guild.id, active, {
                type,
                result: 'win',
                winners: [String(interaction.user.id)],
                reward,
                meta: { endedBy: 'winner', ...meta }
            });
            clearActive(interaction.guild.id);

            let winStatsLine = '';
            try {
                const { getUserEventWins } = require('../db');
                const w = getUserEventWins(interaction.guild.id, interaction.user.id);
                const bits = [];
                if (w.today >= 2) bits.push(`فوزه **#${w.today}** اليوم 🏆`);
                else if (w.today === 1) bits.push('أول فوز له اليوم 🌟');
                if (w.week >= 3) bits.push(`${w.week} فوز هالأسبوع 🔥`);
                if (bits.length) winStatsLine = `\n${bits.join(' · ')}`;
            } catch {
            }

            try {
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🎉 انتهت الفعالية — فيه فائز!')
                    .setDescription(`الفائز: <@${interaction.user.id}> 🏆\nالمكافأة: **${finalReward}** Luna Points 🌙${winStatsLine}`)
                    .setTimestamp();
                await interaction.message.edit({ embeds: [embed], components: [disabledEndRow('انتهت ✅')] });
            } catch {
            }

            try {
                await interaction.reply({ content: `✅ فزت بـ **${finalReward}** Luna Points 🌙`, ephemeral: true });
            } catch {
            }
        };

        // ===== نهاية بدون فائز (خسارة/تعادل ضد البوت) =====
        const finalizeEnd = async ({ type, title, description, meta = {} }) => {
            recordHistory(interaction.guild.id, active, { type, result: meta.result || 'end', winners: [], reward, meta });
            clearActive(interaction.guild.id);

            try {
                const embed = new EmbedBuilder()
                    .setColor('#808080')
                    .setTitle(title)
                    .setDescription(description)
                    .setTimestamp();
                await interaction.message.edit({ embeds: [embed], components: [disabledEndRow('انتهت')] });
            } catch {
            }

            try {
                await interaction.reply({ content: 'انتهت الفعالية — حظ أوفر المره الجاية 🌙', ephemeral: true });
            } catch {
            }
        };

        // ===== ألعاب الاختيارات (جواب واحد صحيح) =====
        if (sub === 'ans') {
            const idx = Math.floor(Number(parts[2]));
            const correctIdx = Math.floor(Number(active.correctIdx));
            if (!Number.isInteger(idx) || idx < 0 || idx > 9) {
                await reply({ content: 'خيار غير صالح 3:' });
                return true;
            }

            if (idx !== correctIdx) {
                // غلط = خروج نهائي بدون إعادة
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    events: {
                        ...(c.events && typeof c.events === 'object' ? c.events : {}),
                        active: {
                            ...active,
                            eliminated: [...eliminated, String(interaction.user.id)]
                        }
                    }
                }));
                await reply({ content: '❌ غلط! خرجت من هالفعالية — ما فيه محاولات ثانية. انتظر الفعالية الجاية 👋' });
                return true;
            }

            await finalizeWin({ type: active.type || 'quiz', meta: {} });
            return true;
        }

        // ===== إكس أو ضد البوت (ذكي) =====
        if (sub === 'xo') {
            const pos = Math.floor(Number(parts[2]));
            if (!Number.isInteger(pos) || pos < 0 || pos > 8) {
                await reply({ content: 'خيار غير صالح 3:' });
                return true;
            }

            const board = Array.isArray(active.board) ? active.board.slice(0, 9) : Array(9).fill(null);
            while (board.length < 9) board.push(null);
            const playerId = active.playerId ? String(active.playerId) : null;

            if (playerId && playerId !== String(interaction.user.id)) {
                await reply({ content: 'هاللعبة لشخص واحد بس 3:' });
                return true;
            }
            if (!playerId) active.playerId = String(interaction.user.id);
            if (board[pos]) {
                await reply({ content: 'هالمربع مأخوذ 3:' });
                return true;
            }

            board[pos] = 'X';
            const w1 = eventGames.xoWinner(board);

            if (w1 === 'X') {
                await finalizeWin({ type: 'xo', meta: { result: 'win' } });
                return true;
            }
            if (eventGames.xoIsFull(board)) {
                await finalizeEnd({
                    type: 'xo',
                    title: '❌⭕ تعادل!',
                    description: `تعادلت مع البوت 🤝\nما فيه نقاط هالمرة — جرّب الفعالية الجاية!`,
                    meta: { result: 'draw' }
                });
                return true;
            }

            const botPos = eventGames.xoBestMove(board);
            if (botPos >= 0) board[botPos] = 'O';

            const w2 = eventGames.xoWinner(board);
            if (w2 === 'O') {
                await finalizeEnd({
                    type: 'xo',
                    title: '❌⭕ البوت فاز!',
                    description: '😅 خسرت… البوت لعب بذكاء. ما فيه نقاط هالمرة.',
                    meta: { result: 'lose' }
                });
                return true;
            }
            if (eventGames.xoIsFull(board)) {
                await finalizeEnd({
                    type: 'xo',
                    title: '❌⭕ تعادل!',
                    description: 'تعادلت مع البوت 🤝\nما فيه نقاط هالمرة.',
                    meta: { result: 'draw' }
                });
                return true;
            }

            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                events: {
                    ...(c.events && typeof c.events === 'object' ? c.events : {}),
                    active: {
                        ...active,
                        board,
                        playerId: String(interaction.user.id),
                        type: 'xo'
                    }
                }
            }));

            try {
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('❌⭕ إكس أو ضد البوت (ذكي)')
                    .setDescription(`اللاعب: <@${interaction.user.id}>\nدورك… فكّر قبل ما تلعب! 🧠\n\nإذا **فزت** تأخذ **${reward}** Luna Points 🌙`)
                    .setTimestamp();
                await interaction.message.edit({ embeds: [embed], components: eventGames.xoRenderComponents(board) });
            } catch {
            }

            try {
                await interaction.reply({ content: '✅ تم دورك.', ephemeral: true });
            } catch {
            }
            return true;
        }

        // ===== نيم ضد البوت (استراتيجية) =====
        if (sub === 'nim') {
            const pileIdx = Math.floor(Number(parts[2]));
            const take = Math.floor(Number(parts[3]));
            const piles = Array.isArray(active.piles) ? active.piles.map((n) => Math.max(0, Math.floor(Number(n) || 0))) : [];

            if (!piles.length || !Number.isInteger(pileIdx) || pileIdx < 0 || pileIdx >= piles.length) {
                await reply({ content: 'خيار غير صالح 3:' });
                return true;
            }
            const playerId = active.playerId ? String(active.playerId) : null;
            if (playerId && playerId !== String(interaction.user.id)) {
                await reply({ content: 'هاللعبة لشخص واحد بس 3:' });
                return true;
            }
            if (!playerId) active.playerId = String(interaction.user.id);
            if (![1, 2, 3].includes(take) || piles[pileIdx] < take) {
                await reply({ content: 'حركتك مو صحيحة (تقدر تأخذ 1-3 عصي من رزمة فيها عصي) 3:' });
                return true;
            }

            piles[pileIdx] -= take;
            const totalAfterPlayer = piles.reduce((s, n) => s + n, 0);

            if (totalAfterPlayer === 0) {
                // اللاعب أخذ آخر عصا = فاز
                await finalizeWin({ type: 'nim', meta: { result: 'win', move: `${pileIdx}:${take}` } });
                return true;
            }

            // دور البوت: يلعب بذكاء (استراتيجية Grundy) مع نسبة أخطاء بسيطة عشان تكون قابلة للفوز
            let botMove = Math.random() < 0.25 ? eventGames.nimRandomMove(piles) : eventGames.nimBestMove(piles);
            if (!botMove) botMove = eventGames.nimRandomMove(piles);

            if (botMove) {
                piles[botMove.pile] -= botMove.take;
            }

            const totalAfterBot = piles.reduce((s, n) => s + n, 0);
            if (totalAfterBot === 0) {
                await finalizeEnd({
                    type: 'nim',
                    title: '🎯 البوت فاز بنيم!',
                    description: `البوت أخذ آخر عصا 😅\n\nحركتك كانت أذكى؟ جرّب الفعالية الجاية!`,
                    meta: { result: 'lose' }
                });
                return true;
            }

            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                events: {
                    ...(c.events && typeof c.events === 'object' ? c.events : {}),
                    active: {
                        ...active,
                        piles,
                        playerId: String(interaction.user.id),
                        type: 'nim'
                    }
                }
            }));

            try {
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🎯 نيم — ضد البوت (ذكي)')
                    .setDescription(
                        `اللاعب: <@${interaction.user.id}>\nأخذت **${take}** من الرزمة ${pileIdx + 1}، والبوت ردّ 🤖\n\n${eventGames.nimLines(piles)}\n\nاللي يأخذ **آخر عصا يفوز** 🏆 — وإن **فزت** تأخذ **${reward}** Luna Points 🌙`
                    )
                    .setTimestamp();
                await interaction.message.edit({ embeds: [embed], components: eventGames.nimRenderComponents(piles) });
            } catch {
            }

            try {
                await interaction.reply({ content: '✅ تم دورك — دور البوت.', ephemeral: true });
            } catch {
            }
            return true;
        }

        await reply({ content: 'هالزر ما عاد يشتغل 3:' });
        return true;
    } finally {
        eventsWinLocks.delete(lockKey);
    }
}

async function handle({ client, interaction }) {
    if (await handleEventButton({ client, interaction })) return true;
    return false;
}

module.exports = { handle };
