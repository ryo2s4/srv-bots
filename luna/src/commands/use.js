const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionsBitField } = require('discord.js');
const { getUserInventory, updateUserInventory } = require('../shopStore');
const { getBoostNameAr } = require('../boostMeta');
const UI = require('../utils/ui');

const boostDurationsMs = {
    xp_boost_25_1h: 60 * 60 * 1000,
    xp_boost_15_24h: 24 * 60 * 60 * 1000,
    luna_boost_25_1h: 60 * 60 * 1000,
    levelup_reward_boost_50_1h: 60 * 60 * 1000
};

async function respond(interaction, options) {
    if (interaction.deferred) return interaction.editReply(options);
    if (interaction.replied) return interaction.followUp({ ...options, ephemeral: options.ephemeral ?? true });
    return interaction.reply({ ...options, ephemeral: options.ephemeral ?? true });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('استخدام عنصر من ممتلكاتك 🎒'),

    async execute(interaction) {
        if (!interaction.guild) {
            return respond(interaction, { content: '❌ آسف بس هاد الشي بس بالسيرفر 3:' });
        }

        const inv = getUserInventory(interaction.guild.id, interaction.user.id);
        const hasTitles = Array.isArray(inv.titles) && inv.titles.length > 0;
        const hasBoosts = Array.isArray(inv.boosts) && inv.boosts.length > 0;
        const services = inv.services && typeof inv.services === 'object' ? inv.services : {};
        const serviceEntries = Object.entries(services).filter(([, v]) => typeof v === 'number' && v > 0);
        const hasServices = serviceEntries.length > 0;

        if (!hasTitles && !hasBoosts && !hasServices) {
            return respond(interaction, { content: '❌ ما عندك عناصر قابلة للاستخدام حاليًا 😅' });
        }

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '🎒 استخدام عنصر',
            description: [
                'اختار نوع العنصر اللي تبغى تستخدمه 👇',
                '',
                '> 💡 العناصر تنباع من `/shop` وتستخدم من هنا.'
            ].join('\n'),
            footerText: 'استخدام العناصر'
        });

        const options = [];
        if (hasTitles) options.push({ label: `ألقاب (${inv.titles.length})`, value: 'title' });
        if (hasBoosts) options.push({ label: `بوستات (${inv.boosts.length})`, value: 'boost' });
        if (hasServices) options.push({ label: `خدمات (${serviceEntries.length})`, value: 'service' });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('useSelect:type')
                .setPlaceholder('اختار نوع')
                .addOptions(options)
        );

        return respond(interaction, { embeds: [embed], components: [row], ephemeral: true });
    },

    async useItem(interaction, { type, value }) {
        if (!interaction.guild) {
            return respond(interaction, { content: '❌ آسف بس هاد الشي بس بالسيرفر 3:' });
        }

        const inv = getUserInventory(interaction.guild.id, interaction.user.id);

        if (type === 'title') {
            const found = inv.titles.find(t => t && typeof t.title === 'string' && t.title === value);
            if (!found) {
                return respond(interaction, { content: '❌ آسف بس ما عندك هاللقب بممتلكاتك 😅' });
            }

            updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => ({ ...cur, activeTitle: value }));

            let appliedNickname = false;
            try {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const botMember = interaction.guild.members.me;
                if (botMember && botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
                    if (botMember.roles.highest.comparePositionTo(member.roles.highest) > 0) {
                        const original = member.user.username;
                        const nextNickRaw = `${original} | ${value}`;
                        const nextNick = nextNickRaw
                            .replace(/\s+/g, ' ')
                            .trim()
                            .slice(0, 32);

                        if (!/@everyone|@here/i.test(nextNick)) {
                            await member.setNickname(nextNick, 'Active title');
                            appliedNickname = true;
                        }
                    }
                }
            } catch {
                appliedNickname = false;
            }

            return respond(interaction, {
                content: appliedNickname
                    ? `✅ 🎭 تم تفعيل لقبك: **${value}** ✨`
                    : `✅ 🎭 تم تفعيل لقبك: **${value}** ✨\n> ⚠️ ملاحظة: ما قدرت أغير النك نيم تلقائيًا بسبب الصلاحيات/الرتب`
            });
        }

        if (type === 'boost') {
            const idx = inv.boosts.findIndex(b => b && b.type === value);
            if (idx < 0) {
                return respond(interaction, { content: '❌ آسف بس ما عندك هالبوست (كرت) بممتلكاتك 😅' });
            }

            const card = inv.boosts[idx] || {};
            let durationMs = Math.floor(Number(card.durationMs) || 0);
            if (!durationMs || durationMs <= 0) {
                durationMs = Math.floor(Number(boostDurationsMs[value]) || 0);
            }
            if (!durationMs || durationMs <= 0) {
                return respond(interaction, { content: '❌ آسف بس ما قدرت أحدد مدة هالبوست… جرب تشتري بوست جديد من المتجر وبعدين فعّله >:' });
            }

            updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
                const next = { ...cur };
                next.boosts = Array.isArray(next.boosts) ? [...next.boosts] : [];
                next.activeBoosts = Array.isArray(next.activeBoosts) ? [...next.activeBoosts] : [];

                // remove one card
                const removeIdx = next.boosts.findIndex(b => b && b.type === value);
                if (removeIdx >= 0) next.boosts.splice(removeIdx, 1);

                next.activeBoosts.push({
                    type: value,
                    acquiredAt: Date.now(),
                    expiresAt: Date.now() + durationMs
                });

                return next;
            });

            const name = getBoostNameAr(value);
            const dur = UI.fmtDuration(durationMs);
            return respond(interaction, {
                embeds: [
                    UI.success([
                        `فعلّت لك **${name}** 🌟`,
                        '',
                        `> ⏳ **المدة:** ${dur}`,
                        '',
                        'يلا نتحمس! 💪'
                    ].join('\n'), { title: '✅ تم تفعيل البوست', footerText: 'البوستات' })
                ]
            });
        }

        if (type === 'service') {
            const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

            if (value === 'rename_once') {
                const renameCount = inv.services && typeof inv.services.renameOnce === 'number' ? inv.services.renameOnce : 0;
                if (!inv.services || renameCount <= 0) {
                    return respond(interaction, { content: '❌ آسف بس ما عندك بطاقة تغيير الاسم ضمن ممتلكاتك 3:' });
                }

                const modal = new ModalBuilder()
                    .setCustomId('renameModal:rename_once')
                    .setTitle('📝 تغيير الاسم (مرة واحدة)');

                const nameInput = new TextInputBuilder()
                    .setCustomId('nickname')
                    .setLabel('اكتب الاسم الجديد')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(32);

                modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                return interaction.showModal(modal);
            }

            if (value === 'xp_transfer') {
                const count = inv.services && typeof inv.services.xpTransfer === 'number' ? inv.services.xpTransfer : 0;
                if (!inv.services || count <= 0) {
                    return respond(interaction, { content: '❌ آسف بس ما عندك خدمة نقل XP ضمن ممتلكاتك 3:' });
                }

                const modal = new ModalBuilder()
                    .setCustomId('xpTransferModal:xp_transfer')
                    .setTitle('🎯 نقل XP (مرة واحدة)');

                const target = new TextInputBuilder()
                    .setCustomId('target')
                    .setLabel('الهدف (User ID أو منشن)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const percent = new TextInputBuilder()
                    .setCustomId('percent')
                    .setLabel('النسبة (5 إلى 50)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue('20');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(target),
                    new ActionRowBuilder().addComponents(percent)
                );

                return interaction.showModal(modal);
            }

            if (value === 'rebalance') {
                const count = inv.services && typeof inv.services.rebalance === 'number' ? inv.services.rebalance : 0;
                if (!inv.services || count <= 0) {
                    return respond(interaction, { content: '❌ آسف بس ما عندك إعادة توازن ضمن ممتلكاتك 3:' });
                }

                const modal = new ModalBuilder()
                    .setCustomId('rebalanceModal:rebalance')
                    .setTitle('🔄 إعادة توازن');

                const confirm = new TextInputBuilder()
                    .setCustomId('confirm')
                    .setLabel('اكتب CONFIRM للتأكيد')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(confirm));
                return interaction.showModal(modal);
            }

            if (value === 'vip_title') {
                const count = inv.services && typeof inv.services.vipTitle === 'number' ? inv.services.vipTitle : 0;
                if (!inv.services || count <= 0) {
                    return respond(interaction, { content: '❌ آسف بس ما عندك خدمة VIP ضمن ممتلكاتك 3:' });
                }

                const vip = 'VIP 👑';
                const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
                updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
                    const next = { ...cur };
                    next.titles = Array.isArray(next.titles) ? [...next.titles] : [];
                    next.titles.push({ title: vip, acquiredAt: Date.now(), expiresAt });
                    next.activeTitle = vip;
                    next.services = next.services && typeof next.services === 'object'
                        ? { ...next.services }
                        : { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0, rerollDaily: 0 };
                    next.services.vipTitle = typeof next.services.vipTitle === 'number' ? next.services.vipTitle : 0;
                    next.services.vipTitle = Math.max(0, next.services.vipTitle - 1);
                    return next;
                });

                return respond(interaction, { content: `✅ 👑 تم تفعيل لقب **${vip}** لمدة 24 ساعة.` });
            }

            if (value === 'reroll_daily') {
                const count = inv.services && typeof inv.services.rerollDaily === 'number' ? inv.services.rerollDaily : 0;
                if (!inv.services || count <= 0) {
                    return respond(interaction, { content: '❌ آسف بس ما عندك بطاقة إعادة توليد يومي ضمن ممتلكاتك 3:' });
                }

                // Rebuild daily rotations immediately
                const { updateGuildShop } = require('../shopStore');
                const { ensureRotations } = require('../shopService');

                updateGuildShop(interaction.guild.id, (g) => {
                    const next = { ...g };
                    next.daily = { dayKey: null, items: [] };
                    next.featured = { dayKey: null, item: null };
                    return next;
                });
                ensureRotations(interaction.guild.id);

                updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
                    const next = { ...cur };
                    next.services = next.services && typeof next.services === 'object'
                        ? { ...next.services }
                        : { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0, rerollDaily: 0 };
                    next.services.rerollDaily = typeof next.services.rerollDaily === 'number' ? next.services.rerollDaily : 0;
                    next.services.rerollDaily = Math.max(0, next.services.rerollDaily - 1);
                    return next;
                });

                return respond(interaction, { content: '✅ 🎲 تم استخدام بطاقة Reroll وإعادة توليد عروض اليوم + Featured.' });
            }

            if (value === 'shield') {
                const count = inv.services && typeof inv.services.shield === 'number' ? inv.services.shield : 0;
                if (!inv.services || count <= 0) {
                    return respond(interaction, { content: '❌ آسف بس ما عندك درع الحماية ضمن ممتلكاتك 3:' });
                }
                return respond(interaction, { content: '💡 🛡️ درع الحماية يُستخدم تلقائيًا عند تنفيذ **إعادة التوازن** لتقليل الخصم.' });
            }

            return respond(interaction, { content: '❌ آسف بس نوع هالخدمة مو مدعوم عندي 3:' });
        }

        return interaction.reply({ content: '❌ آسف بس هالنوع مو مدعوم عندي 3:', ephemeral: true });
    }
};
