const {
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const {
    DEFAULT_TITLE, DEFAULT_MESSAGE, DEFAULT_LEAVE_TITLE, DEFAULT_LEAVE_MESSAGE,
    buildWelcomePayload
} = require('../welcome');

function short(value, max, fallback = '—') {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (!s) return fallback;
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

function channelText(guild, id) {
    if (!id) return 'غير محدد';
    const ch = guild && guild.channels && guild.channels.cache ? guild.channels.cache.get(String(id)) : null;
    return ch ? `<#${ch.id}>` : `<#${id}>`;
}

function buildWelcomePanel(guildId, guild) {
    const cfg = getGuildConfig(guildId);
    const w = cfg && cfg.welcome ? cfg.welcome : {};

    const embed = new EmbedBuilder()
        .setColor('#E7D3B0')
        .setTitle('🎉 لوحة الترحيب والوداع')
        .setDescription(
            'كل شيء في مكان واحد — اضغط الزر اللي تبغيه 👇\n\n' +
            '**المتغيرات:** `{mention}` `{user}` `{username}` `{server}` `{count}`'
        )
        .addFields(
            {
                name: '🟢 الترحيب',
                value:
                    `**الحالة:** ${w.enabled ? 'مفعّل' : 'معطّل'}\n` +
                    `**الروم:** ${channelText(guild, w.channelId)}\n` +
                    `**العنوان:** ${short(w.title, 60, DEFAULT_TITLE)}\n` +
                    `**النص:** ${short(w.message, 90, DEFAULT_MESSAGE)}\n` +
                    `**الصورة:** ${w.imageUrl ? 'مضبوطة 🖼️' : 'لا يوجد'}`,
                inline: false
            },
            {
                name: '👋 الوداع',
                value:
                    `**الحالة:** ${w.leaveEnabled ? 'مفعّل' : 'معطّل'}\n` +
                    `**الروم:** ${channelText(guild, w.leaveChannelId || w.channelId)}\n` +
                    `**النص:** ${short(w.leaveMessage, 90, DEFAULT_LEAVE_MESSAGE)}\n` +
                    `**الصورة:** ${w.leaveImageUrl ? 'مضبوطة 🖼️' : 'لا يوجد'}`,
                inline: false
            },
            {
                name: '⚙️ الخيارات',
                value: `**الشكل:** ${w.embed === false ? 'نص عادي' : 'إيمبد'}\n**منشن العضو:** ${w.ping ? 'نعم' : 'لا'}`,
                inline: false
            }
        )
        .setFooter({ text: '🌙 لونا • /welcome' })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('welcomeUi:welcomeMsg').setLabel('✏️ نص الترحيب').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('welcomeUi:welcomeImg').setLabel('🖼️ صورة الترحيب').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('welcomeUi:channel').setLabel('📺 روم الترحيب').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('welcomeUi:leaveMsg').setLabel('👋 نص الوداع').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('welcomeUi:leaveImg').setLabel('🖼️ صورة الوداع').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('welcomeUi:leaveChannel').setLabel('📺 روم الوداع').setStyle(ButtonStyle.Secondary)
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('welcomeUi:preview').setLabel('🔍 معاينة').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('welcomeUi:test').setLabel('🧪 تجربة').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('welcomeUi:toggleWelcome').setLabel(w.enabled ? '⛔ إيقاف الترحيب' : '✅ تفعيل الترحيب').setStyle(w.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('welcomeUi:toggleLeave').setLabel(w.leaveEnabled ? '⛔ إيقاف الوداع' : '✅ تفعيل الوداع').setStyle(w.leaveEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );
    const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('welcomeUi:toggleEmbed').setLabel(w.embed === false ? '📄 تحويل لإيمبد' : '📄 نص عادي').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('welcomeUi:togglePing').setLabel(w.ping ? '🔔 إلغاء المنشن' : '🔔 منشن العضو').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('welcomeUi:close').setLabel('❌ إغلاق').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2, row3, row4] };
}

async function refreshPanel(interaction) {
    try {
        await interaction.update(buildWelcomePanel(interaction.guild.id, interaction.guild));
    } catch {
        // panel expired — nothing else we can do
    }
}

function textModal(id, title, label, value, paragraph = true) {
    const modal = new ModalBuilder().setCustomId(id).setTitle(title);
    const input = new TextInputBuilder()
        .setCustomId('value')
        .setLabel(label)
        .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(false)
        .setValue(String(value == null ? '' : value).slice(0, 1000));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
}

async function handle({ client, interaction }) {
    if (!interaction.guild) return false;
    if (!(interaction.isButton() || interaction.isModalSubmit())) return false;
    const id = String(interaction.customId || '');
    if (!id.startsWith('welcomeUi:') && !id.startsWith('welcomeModal:')) return false;

    if (!interaction.memberPermissions || !interaction.memberPermissions.has('ManageGuild')) {
        try {
            await interaction.reply({ content: 'تحتاج صلاحية Manage Server 3:', flags: MessageFlags.Ephemeral });
        } catch { /* ignore */ }
        return true;
    }

    // ---------- MODAL SUBMISSIONS ----------
    if (interaction.isModalSubmit()) {
        const action = id.split(':')[1];
        const raw = String(interaction.fields.getTextInputValue('value') || '').trim();
        const w = getGuildConfig(interaction.guild.id).welcome || {};

        if (action === 'welcomeMsg' || action === 'leaveMsg') {
            const key = action === 'welcomeMsg' ? 'message' : 'leaveMessage';
            const fallback = action === 'welcomeMsg' ? DEFAULT_MESSAGE : DEFAULT_LEAVE_MESSAGE;
            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                welcome: { ...(c.welcome || {}), [key]: raw || fallback }
            }));
            return interaction.reply({ content: `✅ تم حفظ النص${raw ? '' : ' (رجع للافتراضي)'}.`, flags: MessageFlags.Ephemeral });
        }

        if (action === 'welcomeImg' || action === 'leaveImg') {
            const key = action === 'welcomeImg' ? 'imageUrl' : 'leaveImageUrl';
            if (raw && !/^https?:\/\//i.test(raw)) {
                return interaction.reply({ content: 'الصورة لازم تكون رابط يبدأ بـ http:// أو https:// 3:', flags: MessageFlags.Ephemeral });
            }
            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c, welcome: { ...(c.welcome || {}), [key]: raw || null }
            }));
            return interaction.reply({ content: raw ? '✅ تم حفظ الصورة.' : '✅ تم حذف الصورة.', flags: MessageFlags.Ephemeral });
        }

        if (action === 'channel' || action === 'leaveChannel') {
            const cleaned = raw.replace(/^<#(\d+)>$/, '$1').trim();
            if (cleaned && !/^\d{15,20}$/.test(cleaned)) {
                return interaction.reply({ content: 'ايدي الروم غير صحيح — مثال: 123456789012345678 3:', flags: MessageFlags.Ephemeral });
            }
            const key = action === 'channel' ? 'channelId' : 'leaveChannelId';
            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c, welcome: { ...(c.welcome || {}), [key]: cleaned || null }
            }));
            return interaction.reply({ content: cleaned ? `✅ تم تحديد الروم: <#${cleaned}>` : '✅ تم إلغاء تحديد الروم.', flags: MessageFlags.Ephemeral });
        }

        return false;
    }

    // ---------- BUTTONS ----------
    const action = id.split(':')[1];
    const cfg = getGuildConfig(interaction.guild.id);
    const w = cfg && cfg.welcome ? cfg.welcome : {};

    if (action === 'close') {
        try {
            await interaction.update({ content: 'تم إغلاق لوحة الترحيب.', embeds: [], components: [] });
        } catch { /* ignore */ }
        return true;
    }

    if (action === 'welcomeMsg' || action === 'leaveMsg') {
        const isLeave = action === 'leaveMsg';
        const modal = textModal(
            `welcomeModal:${action}`,
            isLeave ? 'نص رسالة الوداع' : 'نص رسالة الترحيب',
            'النص (اتركه فاضي للافتراضي)',
            isLeave ? (w.leaveMessage || DEFAULT_LEAVE_MESSAGE) : (w.message || DEFAULT_MESSAGE)
        );
        try { await interaction.showModal(modal); } catch { /* ignore */ }
        return true;
    }

    if (action === 'welcomeImg' || action === 'leaveImg') {
        const isLeave = action === 'leaveImg';
        const modal = textModal(
            `welcomeModal:${action}`,
            isLeave ? 'صورة رسالة الوداع' : 'صورة رسالة الترحيب',
            'رابط الصورة (اتركه فاضي للحذف)',
            isLeave ? (w.leaveImageUrl || '') : (w.imageUrl || ''),
            false
        );
        try { await interaction.showModal(modal); } catch { /* ignore */ }
        return true;
    }

    if (action === 'channel' || action === 'leaveChannel') {
        const isLeave = action === 'leaveChannel';
        const current = isLeave ? (w.leaveChannelId || w.channelId || '') : (w.channelId || '');
        const modal = textModal(
            `welcomeModal:${action}`,
            isLeave ? 'روم رسالة الوداع' : 'روم رسالة الترحيب',
            'Channel ID أو <#123> (اتركه فاضي للإلغاء)',
            current,
            false
        );
        try { await interaction.showModal(modal); } catch { /* ignore */ }
        return true;
    }

    if (action === 'toggleWelcome' || action === 'toggleLeave' || action === 'toggleEmbed' || action === 'togglePing') {
        updateGuildConfig(interaction.guild.id, (c) => {
            const next = { ...(c.welcome || {}) };
            if (action === 'toggleWelcome') next.enabled = !next.enabled;
            if (action === 'toggleLeave') next.leaveEnabled = !next.leaveEnabled;
            if (action === 'toggleEmbed') next.embed = next.embed === false;
            if (action === 'togglePing') next.ping = !next.ping;
            return { ...c, welcome: next };
        });
        await refreshPanel(interaction);
        return true;
    }

    if (action === 'preview') {
        const ctx = { member: interaction.member, guild: interaction.guild, count: interaction.guild.memberCount };
        const a = buildWelcomePayload(w, ctx, 'welcome');
        const b = buildWelcomePayload(w, ctx, 'leave');
        const embeds = [...(a.embeds || []), ...(b.embeds || [])];
        const content = [a.content, b.content].filter(Boolean).join('\n');
        try {
            await interaction.reply({
                content: content || undefined,
                embeds: embeds.length ? embeds : undefined,
                flags: MessageFlags.Ephemeral
            });
        } catch { /* ignore */ }
        return true;
    }

    if (action === 'test') {
        const ctx = { member: interaction.member, guild: interaction.guild, count: interaction.guild.memberCount };
        const results = [];
        const sendTo = async (channelId, payload, label) => {
            if (!channelId) { results.push(`${label}: ما فيه روم محدد`); return; }
            const ch = interaction.guild.channels.cache.get(String(channelId))
                || await interaction.guild.channels.fetch(String(channelId)).catch(() => null);
            if (!ch || typeof ch.send !== 'function') { results.push(`${label}: الروم غير متاح`); return; }
            try {
                const sent = await ch.send(payload);
                results.push(`${label}: ✅ <#${ch.id}>`);
                if (sent && typeof sent.delete === 'function' && w.autoDeleteTest) {
                    setTimeout(() => sent.delete().catch(() => {}), 10_000);
                }
            } catch (err) {
                results.push(`${label}: ❌ ${err.message}`);
            }
        };
        await sendTo(w.channelId, buildWelcomePayload(w, ctx, 'welcome'), 'الترحيب');
        await sendTo(w.leaveChannelId || w.channelId, buildWelcomePayload(w, ctx, 'leave'), 'الوداع');
        try {
            await interaction.reply({ content: results.join('\n'), flags: MessageFlags.Ephemeral });
        } catch { /* ignore */ }
        return true;
    }

    return false;
}

module.exports = { handle, buildWelcomePanel };
