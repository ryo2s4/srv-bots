const { PermissionsBitField, MessageFlags } = require('discord.js');

const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const { sendGuildLog } = require('../guildLog');
const { isStaff } = require('../utils/permissions');
const { extractId } = require('../shopService');

const { normalizeTicketTypeId, getTicketMetaFromChannel, setTicketMetaForChannel, fmtMsShort, fmtDurationPretty, parseDurationLike } = require('../ticketsService');

const UI = require('../utils/ui');

const ticketOpenLocks = new Map();
const ticketRecentCreated = new Map();

async function handleTicketsUi({ client, interaction }) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'آسف بس هالخيار بس بالسيرفر 3:', ephemeral: true });
    }

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس ما عندك صلاحية عشان تستعمل هاد الامر p:', ephemeral: true });
    }

    const action = interaction.customId.split(':')[1];
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ChannelType } = require('discord.js');

    if (action === 'edit_panel') {
        const cfg = getGuildConfig(interaction.guild.id);
        const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
        const types = Array.isArray(tcfg.types) ? tcfg.types.filter(Boolean) : [];

        if (types.length === 0) {
            return interaction.reply({ content: 'ما عندك أنواع تكتات عشان تعدلها 3:', ephemeral: true });
        }

        const options = types.slice(0, 25).map((t) => ({
            label: (t.name || t.id || 'ticket').slice(0, 100),
            description: (t.id || 'ticket').slice(0, 100),
            value: t.id
        })).filter((o) => o.value);

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticketsSelect:edit')
                .setPlaceholder('اختار نوع التكت')
                .addOptions(options)
        );

        return interaction.reply({ content: 'اختار نوع تكت لتعديله:', components: [row], ephemeral: true });
    }

    if (action === 'set_channel') {
        const modal = new ModalBuilder()
            .setCustomId('ticketsModal:set_channel')
            .setTitle('تحديد قناة بانل التكتات');

        const channelId = new TextInputBuilder()
            .setCustomId('channelId')
            .setLabel('Channel ID (أو منشن <#123>)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(channelId));
        return interaction.showModal(modal);
    }

    if (action === 'set_category') {
        const modal = new ModalBuilder()
            .setCustomId('ticketsModal:set_category')
            .setTitle('تحديد Category للتكتات');

        const categoryId = new TextInputBuilder()
            .setCustomId('categoryId')
            .setLabel('Category ID (أو منشن <#123>)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(categoryId));
        return interaction.showModal(modal);
    }

    if (action === 'timers') {
        const cfg = getGuildConfig(interaction.guild.id);
        const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
        const warnMs = Number(tcfg.noResponseWarnMs) || 0;
        const closeNoRespMs = Number(tcfg.noResponseCloseMs) || 0;
        const closeInactMs = Number(tcfg.inactivityCloseMs) || 0;

        const modal = new ModalBuilder()
            .setCustomId('ticketsModal:timers')
            .setTitle('إعدادات تايمر التكتات');

        const warn = new TextInputBuilder()
            .setCustomId('noResponseWarn')
            .setLabel('تنبيه عدم الرد (مثال: 30m / 2h / 0)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(fmtMsShort(warnMs).slice(0, 100));

        const closeNoResp = new TextInputBuilder()
            .setCustomId('noResponseClose')
            .setLabel('إغلاق بعد عدم الرد (مثال: 6h / 1d / 0)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(fmtMsShort(closeNoRespMs).slice(0, 100));

        const closeInact = new TextInputBuilder()
            .setCustomId('inactivityClose')
            .setLabel('إغلاق بعد عدم النشاط (مثال: 2d / 0)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(fmtMsShort(closeInactMs).slice(0, 100));

        modal.addComponents(
            new ActionRowBuilder().addComponents(warn),
            new ActionRowBuilder().addComponents(closeNoResp),
            new ActionRowBuilder().addComponents(closeInact)
        );
        return interaction.showModal(modal);
    }

    if (action === 'add') {
        const modal = new ModalBuilder()
            .setCustomId('ticketsModal:add_type')
            .setTitle('إضافة نوع تكت');

        const name = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('اسم التكت')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(40);

        const emoji = new TextInputBuilder()
            .setCustomId('emoji')
            .setLabel('إيموجي (اختياري)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(20);

        const description = new TextInputBuilder()
            .setCustomId('description')
            .setLabel('وصف النوع (اختياري)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100);

        const openMessage = new TextInputBuilder()
            .setCustomId('openMessage')
            .setLabel('رسالة داخل التكت (اختياري)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(900);

        const staffRoles = new TextInputBuilder()
            .setCustomId('staffRoles')
            .setLabel('رتب المسؤولين (IDs/mentions)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(200);

        modal.addComponents(
            new ActionRowBuilder().addComponents(name),
            new ActionRowBuilder().addComponents(emoji),
            new ActionRowBuilder().addComponents(description),
            new ActionRowBuilder().addComponents(openMessage),
            new ActionRowBuilder().addComponents(staffRoles)
        );
        return interaction.showModal(modal);
    }

    if (action === 'edit' || action === 'remove') {
        const cfg = getGuildConfig(interaction.guild.id);
        const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
        const types = Array.isArray(tcfg.types) ? tcfg.types.filter(Boolean) : [];

        if (types.length === 0) {
            return interaction.reply({ content: 'ما عندك أنواع تكتات عشان تعدل/تحذف 3:', ephemeral: true });
        }

        const options = types.slice(0, 25).map((t) => ({
            label: (t.name || t.id || 'ticket').slice(0, 100),
            description: (t.id || 'ticket').slice(0, 100),
            value: t.id
        })).filter((o) => o.value);

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`ticketsSelect:${action}`)
                .setPlaceholder('اختار نوع التكت')
                .addOptions(options)
        );

        return interaction.reply({
            content: action === 'edit' ? 'اختار نوع تكت لتعديله:' : 'اختار نوع تكت لحذفه:',
            components: [row],
            ephemeral: true
        });
    }

    if (action === 'publish') {
        const cfg = getGuildConfig(interaction.guild.id);
        const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
        const panelChannelId = typeof tcfg.panelChannelId === 'string' ? tcfg.panelChannelId : null;
        const categoryId = typeof tcfg.categoryId === 'string' ? tcfg.categoryId : null;
        const types = Array.isArray(tcfg.types) ? tcfg.types.filter(Boolean) : [];

        if (!panelChannelId) {
            return interaction.reply({ content: 'لازم تحدد قناة البانل أول (`تحديد قناة البانل`) 3:', ephemeral: true });
        }
        if (!categoryId) {
            return interaction.reply({ content: 'لازم تحدد Category أول (`تحديد Category`) 3:', ephemeral: true });
        }
        if (types.length === 0) {
            return interaction.reply({ content: 'أضيفي نوع تكت واحد على الأقل قبل النشر 3:', ephemeral: true });
        }

        let channel;
        try {
            channel = await interaction.guild.channels.fetch(panelChannelId);
        } catch {
            channel = null;
        }

        if (!channel || !channel.isTextBased() || channel.type === ChannelType.GuildCategory) {
            return interaction.reply({ content: 'آسف بس قناة البانل غير صالحة… تأكدي من الـ ID 3:', ephemeral: true });
        }

        const panelEmbed = UI.embed({
            title: '🎫 فتح تكت',
            color: UI.COLORS.tickets,
            description: 'اختار نوع التكت من القائمة 👇 وبفتح لك روم خاص.'
        });

        const { parseEmoji } = require('discord.js');

        const sanitizeUnicodeEmoji = (raw) => {
            const s = String(raw || '').trim();
            if (!s || s.startsWith('<')) return '';
            const withoutVS = s.replace(/[\uFE0E\uFE0F]/g, '');
            if (!withoutVS) return '';
            try {
                if (!/\p{Extended_Pictographic}/u.test(withoutVS)) return '';
            } catch {
            }
            return withoutVS;
        };

        const opts = types.map((t) => {
            const id = String(t?.id || '').trim();
            const name = String(t?.name || id || 'ticket').trim();
            const desc = String(t?.description || '').trim();

            let emoji;
            if (t?.emoji) {
                const raw = String(t.emoji).trim();
                const parsed = parseEmoji(raw);
                if (parsed && parsed.id) {
                    emoji = { id: parsed.id, name: parsed.name || 'emoji', animated: Boolean(parsed.animated) };
                } else {
                    const uni = sanitizeUnicodeEmoji(raw);
                    if (uni) emoji = { name: uni };
                }
            }

            const opt = {
                label: name.slice(0, 100),
                value: id.slice(0, 100),
                emoji
            };

            if (desc) opt.description = desc.slice(0, 100);
            return opt;
        })
            .filter((o) => typeof o.value === 'string' && o.value.length > 0)
            .filter((o) => typeof o.label === 'string' && o.label.length > 0)
            .slice(0, 25);

        if (opts.length === 0) {
            return interaction.reply({ content: 'آسف بس ما قدرت أنشر البانل لأن أنواع التكت غير صالحة (id/label فاضية). افتحي إدارة التكتات وتاكدي أن كل نوع له id واسم 3:', ephemeral: true });
        }

        const safeOpts = opts.map((o) => {
            const out = { ...o };
            if (!out.description || String(out.description).trim().length === 0) delete out.description;
            return out;
        });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticketsPanel:open')
                .setPlaceholder('اختار نوع التكت')
                .addOptions(safeOpts)
        );

        const formatMissingPerms = (missing) => {
            if (!missing || missing.length === 0) return null;
            const lines = missing.map((p) => `- ${p}`).join('\n');
            return `آسف بس ما عندي الصلاحيات الكافية بقناة البانل 😭\n\nالصلاحيات الناقصة:\n${lines}`;
        };

        const me = interaction.guild.members.me;
        if (!me) {
            return interaction.reply({ content: 'آسف بس ما قدرت أحدد حساب البوت بالسيرفر 3:', ephemeral: true });
        }

        const needed = [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks
        ];
        const missing = channel.permissionsFor(me)?.missing(needed) || [];
        const msg = formatMissingPerms(missing);
        if (msg) {
            return interaction.reply({ content: msg, ephemeral: true });
        }

        try {
            await channel.send({ embeds: [panelEmbed], components: [row] });
        } catch (err) {
            console.error('tickets:publish panel send error:', err?.code || err);
            try {
                const util = require('node:util');
                if (err?.rawError) {
                    console.error('tickets:publish rawError(full):', util.inspect(err.rawError, { depth: null }));
                }
                if (err?.errors) {
                    console.error('tickets:publish errors(full):', util.inspect(err.errors, { depth: null }));
                }
                if (err?.requestBody) {
                    console.error('tickets:publish requestBody:', util.inspect(err.requestBody, { depth: null }));
                }
            } catch {
            }
            if (err?.rawError) {
                console.error('tickets:publish rawError:', err.rawError);
            }
            if (err?.errors) {
                console.error('tickets:publish errors:', err.errors);
            }
            return interaction.reply({ content: 'آسف بس ما قدرت أنشر البانل… عطيني لوق الكونسل/الترمنل اللي طلع عشان أحدد السبب 3:', ephemeral: true });
        }

        return interaction.reply({ content: `✅ تم نشر بانل التكتات في <#${panelChannelId}>`, ephemeral: true });
    }

    return;
}

async function handleTicketsSelect({ interaction }) {
    if (!interaction.guild) return;

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس ما عندك صلاحية عشان تستعمل هاد الامر p:', ephemeral: true });
    }

    const mode = interaction.customId.split(':')[1];
    const selectedId = interaction.values && interaction.values[0] ? interaction.values[0] : '';
    const cfg = getGuildConfig(interaction.guild.id);
    const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
    const types = Array.isArray(tcfg.types) ? tcfg.types.filter(Boolean) : [];
    const found = types.find((t) => t && t.id === selectedId);

    if (!found) {
        return interaction.reply({ content: 'آسف بس هالنوع ما عاد موجود 3:', ephemeral: true });
    }

    if (mode === 'remove') {
        updateGuildConfig(interaction.guild.id, (c) => {
            const next = { ...c };
            next.tickets = next.tickets && typeof next.tickets === 'object'
                ? { ...next.tickets }
                : { panelChannelId: null, categoryId: null, types: [] };
            const list = Array.isArray(next.tickets.types) ? next.tickets.types.filter((t) => t && t.id !== selectedId) : [];
            next.tickets.types = list;
            return next;
        });

        try {
            return await interaction.update({ content: `✅ تم حذف نوع التكت: **${found.name || found.id}**`, components: [] });
        } catch {
            return interaction.reply({ content: `✅ تم حذف نوع التكت: **${found.name || found.id}**`, ephemeral: true });
        }
    }

    if (mode === 'edit') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const modal = new ModalBuilder()
            .setCustomId(`ticketsModal:edit_type:${encodeURIComponent(selectedId)}`)
            .setTitle('تعديل نوع تكت');

        const name = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('اسم التكت')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(40)
            .setValue(found.name || ' ');

        const emoji = new TextInputBuilder()
            .setCustomId('emoji')
            .setLabel('إيموجي (اختياري)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(20)
            .setValue(found.emoji || ' ');

        const description = new TextInputBuilder()
            .setCustomId('description')
            .setLabel('وصف النوع (اختياري)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100)
            .setValue(found.description || ' ');

        const openMessage = new TextInputBuilder()
            .setCustomId('openMessage')
            .setLabel('رسالة داخل التكت (اختياري)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(900)
            .setValue(found.openMessage || ' ');

        const staffRoles = new TextInputBuilder()
            .setCustomId('staffRoles')
            .setLabel('رتب المسؤولين (IDs/mentions)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(200)
            .setValue((Array.isArray(found.staffRoleIds) ? found.staffRoleIds.join(',') : '') || ' ');

        modal.addComponents(
            new ActionRowBuilder().addComponents(name),
            new ActionRowBuilder().addComponents(emoji),
            new ActionRowBuilder().addComponents(description),
            new ActionRowBuilder().addComponents(openMessage),
            new ActionRowBuilder().addComponents(staffRoles)
        );

        try {
            return await interaction.showModal(modal);
        } catch {
            return interaction.reply({ content: 'آسف بس انتهت صلاحية القائمة… شغّل `/tickets` مرة ثانية 3:', ephemeral: true });
        }
    }

    return;
}

async function handleTicketsPanelOpen({ client, interaction }) {
    if (!interaction.guild) return;

    const respondOpen = async (payload) => {
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
        const ephemeral = payload.ephemeral ?? true;
        const nextPayload = { ...payload };
        delete nextPayload.ephemeral;
        return interaction.reply({ ...nextPayload, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
    };

    const lockKey = `${interaction.guild.id}:${interaction.user.id}`;
    const now = Date.now();

    const recent = ticketRecentCreated.get(lockKey);
    if (recent && recent.expiresAt && now < recent.expiresAt && recent.channelId) {
        try {
            const ch = await interaction.guild.channels.fetch(recent.channelId).catch(() => null);
            if (ch) {
                return respondOpen({ content: `✅ عندك تكت جديد جاهز: <#${recent.channelId}>` });
            }
        } catch {
        }
        ticketRecentCreated.delete(lockKey);
    }

    const lockExp = ticketOpenLocks.get(lockKey);
    if (lockExp && now >= lockExp) {
        ticketOpenLocks.delete(lockKey);
    }
    const lockExp2 = ticketOpenLocks.get(lockKey);
    if (lockExp2 && now < lockExp2) {
        try {
            return interaction.reply({ content: '⏳ شوي شوي… قاعد أفتح لك التكت 😅', flags: MessageFlags.Ephemeral });
        } catch {
            return;
        }
    }
    ticketOpenLocks.set(lockKey, now + 12 * 1000);

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
    } catch {
    }

    const selectedId = interaction.values && interaction.values[0] ? interaction.values[0] : '';
    const cfg = getGuildConfig(interaction.guild.id);
    const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
    const categoryId = typeof tcfg.categoryId === 'string' ? tcfg.categoryId : null;
    const types = Array.isArray(tcfg.types) ? tcfg.types.filter(Boolean) : [];
    const type = types.find((t) => t && t.id === selectedId);

    if (!type) {
        return respondOpen({ content: 'آسف بس نوع التكت هذا مو موجود 3:' });
    }
    if (!categoryId) {
        return respondOpen({ content: 'آسف بس الإدارة ما حددت Category للتكتات للحين 3:' });
    }

    let category;
    try {
        category = await interaction.guild.channels.fetch(categoryId);
    } catch {
        category = null;
    }
    if (!category || category.type !== 4) {
        return respondOpen({ content: 'آسف بس Category مو صالحة… كلمي الإدارة 3:' });
    }

    const { ChannelType, PermissionFlagsBits } = require('discord.js');
    const staffRoleIds = Array.isArray(type.staffRoleIds) ? type.staffRoleIds.map(String).filter(Boolean) : [];
    const baseName = `ticket-${(type.id || 't').slice(0, 10)}-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9\-]/g, '-')
        .slice(0, 90);

    try {
        const created = await interaction.guild.channels.create({
            name: baseName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
                ...staffRoleIds.map((rid) => ({
                    id: rid,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
                })),
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
            ]
        });

        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const staffMention = staffRoleIds.length ? `${staffRoleIds.map((rid) => `<@&${rid}>`).join(' ')}` : '';
        const openMessage = String(type.openMessage || '').trim();

        const openedAt = Date.now();

        await setTicketMetaForChannel(created, {
            ownerId: String(interaction.user.id),
            typeId: String(type.id || ''),
            typeName: String(type.name || type.id || ''),
            staffRoleIds,
            createdAt: openedAt,
            openedAt,
            lastUserMsgAt: openedAt,
            lastStaffMsgAt: 0,
            noResponseWarnedAt: 0,
            claimedBy: null,
            closed: false
        });

        updateGuildConfig(interaction.guild.id, (c) => {
            const next = { ...c };
            next.tickets = next.tickets && typeof next.tickets === 'object' ? { ...next.tickets } : { panelChannelId: null, categoryId: null, archiveChannelId: null, types: [] };
            const list = Array.isArray(next.tickets.activeChannelIds) ? next.tickets.activeChannelIds.map(String) : [];
            if (!list.includes(String(created.id))) list.push(String(created.id));
            next.tickets.activeChannelIds = list.slice(0, 500);
            return next;
        });

        const embed = UI.embed({
            title: '🎫 تم فتح تكت',
            color: UI.COLORS.tickets,
            description:
                `> **العضو:** ${interaction.user}\n` +
                `> **النوع:** ${type.emoji ? `${type.emoji} ` : ''}**${type.name || type.id}**\n` +
                `> **وقت الفتح:** <t:${Math.floor(openedAt / 1000)}:F> (<t:${Math.floor(openedAt / 1000)}:R>)\n\n` +
                (openMessage ? openMessage : 'اكتب مشكلتك هنا، وفريق الإدارة بيرد عليك قريبًا.')
        });

        const row = UI.row(
            UI.btn('ticket:claim', '🤝 إستلام', { style: ButtonStyle.Primary }),
            UI.btn('ticket:close', '🔒 إغلاق', { style: ButtonStyle.Danger })
        );

        await created.send({
            content: staffMention || undefined,
            embeds: [embed],
            components: [row],
            allowedMentions: { roles: staffRoleIds }
        });

        ticketRecentCreated.set(lockKey, { channelId: created.id, expiresAt: Date.now() + 60 * 1000 });

        try {
            return await interaction.editReply({ content: `✅ تم فتح تكت لك: <#${created.id}>` });
        } catch {
            return;
        }
    } catch {
        try {
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: 'آسف بس ما قدرت أفتح التكت… تأكدي إن عندي صلاحيات إنشاء قنوات داخل الـ Category 3:' });
            }
        } catch {
        }
        return interaction.reply({ content: 'آسف بس ما قدرت أفتح التكت… تأكدي إن عندي صلاحيات إنشاء قنوات داخل الـ Category 3:', ephemeral: true });
    }
}

async function handleTicketsModal({ interaction }) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
    }

    const parts = interaction.customId.split(':');
    const modalType = parts[1];
    const encodedId = parts[2] || null;
    const editId = encodedId ? decodeURIComponent(encodedId) : null;

    if (modalType !== 'set_archive') {
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'آسف بس ما عندك صلاحية عشان تستعمل هاد الامر p:', ephemeral: true });
        }
    }

    if (modalType === 'timers') {
        const warnRaw = String(interaction.fields.getTextInputValue('noResponseWarn') || '').trim();
        const closeNoRespRaw = String(interaction.fields.getTextInputValue('noResponseClose') || '').trim();
        const closeInactRaw = String(interaction.fields.getTextInputValue('inactivityClose') || '').trim();

        const warnMs = parseDurationLike(warnRaw);
        const closeNoRespMs = parseDurationLike(closeNoRespRaw);
        const closeInactMs = parseDurationLike(closeInactRaw);

        if (warnMs === null || closeNoRespMs === null || closeInactMs === null) {
            return interaction.reply({ content: 'آسف بس صيغة الوقت غلط 3: مثال: 30m أو 2h أو 1d أو 0', ephemeral: true });
        }

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            tickets: {
                ...(c.tickets && typeof c.tickets === 'object' ? c.tickets : {}),
                noResponseWarnMs: warnMs,
                noResponseCloseMs: closeNoRespMs,
                inactivityCloseMs: closeInactMs
            }
        }));

        return interaction.reply({ content: '✅ تم حفظ إعدادات التايمر.', ephemeral: true });
    }

    if (modalType === 'set_archive') {
        const { ChannelType } = require('discord.js');
        const ch = interaction.channel;
        if (!ch || ch.type !== ChannelType.GuildText) {
            return interaction.reply({ content: 'آسف بس هالخيار بس برومات التكت 3:', ephemeral: true });
        }

        const meta = getTicketMetaFromChannel(ch);
        if (!meta) {
            return interaction.reply({ content: 'آسف بس ما قدرت أحدد بيانات هالتكت 3:', ephemeral: true });
        }

        const staffRoleIds = Array.isArray(meta.staffRoleIds) ? meta.staffRoleIds.map(String).filter(Boolean) : [];
        const cfg = getGuildConfig(interaction.guild.id);
        const staffOk = isStaff(interaction.member, cfg, staffRoleIds);

        if (!staffOk) {
            return interaction.reply({ content: 'آسف بس هذا الخيار للإدارة/الستاف فقط 3:', ephemeral: true });
        }

        const raw = String(interaction.fields.getTextInputValue('channelId') || '').trim();
        const archiveChannelId = extractId(raw);
        if (!archiveChannelId) return interaction.reply({ content: 'آسف بس ما فهمت Channel ID 3:', ephemeral: true });

        updateGuildConfig(interaction.guild.id, (c) => {
            const next = { ...c };
            next.tickets = next.tickets && typeof next.tickets === 'object'
                ? { ...next.tickets, archiveChannelId }
                : { panelChannelId: null, categoryId: null, archiveChannelId, types: [] };
            return next;
        });

        return interaction.reply({ content: `✅ تم حفظ مكان الأرشفة: <#${archiveChannelId}>`, ephemeral: true });
    }

    if (modalType === 'set_channel') {
        const raw = String(interaction.fields.getTextInputValue('channelId') || '').trim();
        const channelId = extractId(raw);
        if (!channelId) return interaction.reply({ content: 'آسف بس ما فهمت Channel ID 3:', ephemeral: true });

        updateGuildConfig(interaction.guild.id, (c) => {
            const next = { ...c };
            next.tickets = next.tickets && typeof next.tickets === 'object'
                ? { ...next.tickets, panelChannelId: channelId }
                : { panelChannelId: channelId, categoryId: null, types: [] };
            return next;
        });
        return interaction.reply({ content: `✅ تم حفظ قناة البانل: <#${channelId}>`, ephemeral: true });
    }

    if (modalType === 'set_category') {
        const raw = String(interaction.fields.getTextInputValue('categoryId') || '').trim();
        const categoryId = extractId(raw);
        if (!categoryId) return interaction.reply({ content: 'آسف بس ما فهمت Category ID 3:', ephemeral: true });

        updateGuildConfig(interaction.guild.id, (c) => {
            const next = { ...c };
            next.tickets = next.tickets && typeof next.tickets === 'object'
                ? { ...next.tickets, categoryId }
                : { panelChannelId: null, categoryId, types: [] };
            return next;
        });
        return interaction.reply({ content: `✅ تم حفظ Category للتكتات: <#${categoryId}>`, ephemeral: true });
    }

    if (modalType === 'add_type') {
        const name = String(interaction.fields.getTextInputValue('name') || '').trim();
        const emoji = String(interaction.fields.getTextInputValue('emoji') || '').trim();
        const description = String(interaction.fields.getTextInputValue('description') || '').trim();
        const openMessage = String(interaction.fields.getTextInputValue('openMessage') || '').trim();
        const staffRaw = String(interaction.fields.getTextInputValue('staffRoles') || '').trim();
        if (!name) return interaction.reply({ content: 'آسف بس اسم التكت ما ينفع فاضي 3:', ephemeral: true });

        const id = normalizeTicketTypeId(name);
        if (!id) return interaction.reply({ content: 'آسف بس ما قدرت أسوي ID لهالاسم 3:', ephemeral: true });

        const staffRoleIds = staffRaw
            ? (staffRaw.match(/\d{5,}/g) || []).map(String)
            : [];

        updateGuildConfig(interaction.guild.id, (c) => {
            const next = { ...c };
            next.tickets = next.tickets && typeof next.tickets === 'object'
                ? { ...next.tickets }
                : { panelChannelId: null, categoryId: null, types: [] };

            const types = Array.isArray(next.tickets.types) ? [...next.tickets.types] : [];
            if (types.some((t) => t && t.id === id)) {
                return next;
            }
            types.push({
                id,
                name,
                emoji: emoji || '',
                description: description || '',
                openMessage: openMessage || '',
                staffRoleIds
            });
            next.tickets.types = types;
            return next;
        });

        return interaction.reply({ content: `✅ تم إضافة نوع تكت: **${name}** (${id})`, ephemeral: true });
    }

    if (modalType === 'edit_type') {
        if (!editId) return interaction.reply({ content: 'آسف بس ما عرفت نوع التكت للتعديل 3:', ephemeral: true });

        const name = String(interaction.fields.getTextInputValue('name') || '').trim();
        const emoji = String(interaction.fields.getTextInputValue('emoji') || '').trim();
        const description = String(interaction.fields.getTextInputValue('description') || '').trim();
        const openMessage = String(interaction.fields.getTextInputValue('openMessage') || '').trim();
        const staffRaw = String(interaction.fields.getTextInputValue('staffRoles') || '').trim();
        if (!name) return interaction.reply({ content: 'آسف بس اسم التكت ما ينفع فاضي 3:', ephemeral: true });

        const staffRoleIds = staffRaw
            ? (staffRaw.match(/\d{5,}/g) || []).map(String)
            : [];

        let updated = false;
        updateGuildConfig(interaction.guild.id, (c) => {
            const next = { ...c };
            next.tickets = next.tickets && typeof next.tickets === 'object'
                ? { ...next.tickets }
                : { panelChannelId: null, categoryId: null, types: [] };
            const types = Array.isArray(next.tickets.types) ? [...next.tickets.types] : [];
            next.tickets.types = types.map((t) => {
                if (!t || t.id !== editId) return t;
                updated = true;
                return {
                    ...t,
                    name,
                    emoji: emoji || '',
                    description: description || '',
                    openMessage: openMessage || '',
                    staffRoleIds
                };
            });
            return next;
        });

        if (!updated) {
            return interaction.reply({ content: 'آسف بس هالنوع ما عاد موجود 3:', ephemeral: true });
        }
        return interaction.reply({ content: `✅ تم تعديل نوع التكت: **${name}**`, ephemeral: true });
    }

    return interaction.reply({ content: 'آسف بس هالمودال مو معروف 3:', ephemeral: true });
}

// ─── Safe interaction helpers ─────────────────────────────────────
/** Try to respond to the interaction silently if not yet acknowledged. */
async function ticketDefer(interaction) {
    if (interaction.deferred || interaction.replied) return true;
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return true;
    } catch {
        // Interaction may have been deferUpdate'd by the auto-defer timer
        if (interaction.deferred) return true;
        return false;
    }
}

/** Resolve the interaction — works after both deferReply and deferUpdate. */
async function ticketReply(interaction, content) {
    try {
        if (interaction.replied) {
            await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.deferred) {
            await interaction.editReply({ content });
            return;
        }
        // Not acknowledged yet — use reply
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch {
        // Last resort — try followUp
        try { await interaction.followUp({ content, flags: MessageFlags.Ephemeral }); } catch { /* ignore */ }
    }
}

async function handleTicketButtons({ client, interaction }) {
    if (!interaction.guild) return;

    const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

    const parts = String(interaction.customId || '').split(':');
    const action = String(parts[1] || '');

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased || !channel.isTextBased()) {
        return ticketReply(interaction, 'آسف بس هالخيار بس برومات التكت 3:');
    }

    const meta = getTicketMetaFromChannel(channel);
    if (!meta) {
        return ticketReply(interaction, 'آسف بس ما قدرت أحدد بيانات هالتكت 3:');
    }

    const staffRoleIds = Array.isArray(meta.staffRoleIds) ? meta.staffRoleIds.map(String).filter(Boolean) : [];
    const cfg = getGuildConfig(interaction.guild.id);
    const staffOk = isStaff(interaction.member, cfg, staffRoleIds);

    if (!staffOk) {
        return ticketReply(interaction, 'آسف بس هذا الخيار للإدارة/الستاف فقط 3:');
    }

    // For buttons: silent deferUpdate at the top — no loading state ever
    // Modals (set_archive) need the interaction untouched
    if (action !== 'set_archive') {
        try { await interaction.deferUpdate(); } catch { /* ignore, auto-defer will handle */ }
    }

    // After deferUpdate, we MUST use followUp (not editReply which edits the original message)
    const btnReply = (content) => interaction.followUp({ content, flags: MessageFlags.Ephemeral });

    if (action === 'set_archive') {
        const modal = new ModalBuilder()
            .setCustomId('ticketsModal:set_archive')
            .setTitle('تحديد مكان أرشفة التكتات');

        const channelId = new TextInputBuilder()
            .setCustomId('channelId')
            .setLabel('Channel ID (أو منشن <#123>)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(channelId));
        return interaction.showModal(modal);
    }

    if (action === 'claim') {
        if (meta.claimedBy && String(meta.claimedBy) !== String(interaction.user.id)) {
            return btnReply('التكت مستلم بالفعل من شخص ثاني 3:');
        }

        const claimerId = String(interaction.user.id);
        const ownerId = String(meta.ownerId || '');

        meta.claimedBy = claimerId;
        meta.claimedAt = Date.now();

        // INSTANT response
        const done = btnReply('✅ تم.');

        // Background work — no await, fire and forget
        (async () => {
            try {
                const permissionOps = [
                    channel.permissionOverwrites.edit(claimerId, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true }),
                    ...staffRoleIds.map((rid) => channel.permissionOverwrites.edit(rid, { SendMessages: false })),
                ];
                if (ownerId) {
                    permissionOps.push(channel.permissionOverwrites.edit(ownerId, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true }));
                }
                await Promise.all(permissionOps);
            } catch {}
            await setTicketMetaForChannel(channel, meta).catch(() => {});
            await Promise.all([
                channel.send({ content: `✅ تم استلام التكت بواسطة: ${interaction.user}` }).catch(() => {}),
                (async () => {
                    const logEmbed = UI.embed({
                        title: '🎫 تكت: تم الاستلام',
                        color: UI.COLORS.tickets,
                        description: `${interaction.user} استلم التكت: <#${channel.id}>`
                    });
                    await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
                })().catch(() => {}),
            ]).catch(() => {});
        })();

        return done;
    }

    if (action === 'close') {
        const ownerId = String(meta.ownerId || '');
        const claimerId = meta.claimedBy ? String(meta.claimedBy) : '';

        meta.closed = true;
        meta.closedAt = Date.now();
        meta.closedBy = String(interaction.user.id);

        const openedAt = Number(meta.openedAt) || Number(meta.createdAt) || 0;
        const openDuration = openedAt ? Math.max(0, Number(meta.closedAt) - openedAt) : 0;

        // INSTANT response
        const done = btnReply('✅ تم إغلاق التكت.');

        // Background work
        (async () => {
            // Lock the channel: deny everyone (including the opener) from
            // sending, then re-allow staff. Await the edits and verify so a
            // silent permission failure can't leave the ticket "closed" while
            // the user keeps typing.
            let lockOk = true;
            try {
                const everyoneId = interaction.guild.roles.everyone.id;
                const ops = [
                    channel.permissionOverwrites.edit(everyoneId, {
                        SendMessages: false, AddReactions: false,
                        CreatePublicThreads: false, CreatePrivateThreads: false
                    }),
                    channel.permissionOverwrites.edit(client.user.id, {
                        ViewChannel: true, SendMessages: true,
                        ReadMessageHistory: true, ManageMessages: true
                    })
                ];
                if (ownerId) ops.push(channel.permissionOverwrites.edit(ownerId, { SendMessages: false, AddReactions: false }));
                if (claimerId) ops.push(channel.permissionOverwrites.edit(claimerId, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true }));
                for (const rid of staffRoleIds) {
                    ops.push(channel.permissionOverwrites.edit(rid, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true }));
                }
                await Promise.all(ops);

                // Read back the decisive overwrite — an admin can still bypass
                // it, but a normal member must be denied after this point.
                if (ownerId) {
                    const fresh = await channel.permissionOverwrites.fetch(ownerId).catch(() => null);
                    if (fresh && !fresh.deny.has('SendMessages')) lockOk = false;
                }
            } catch (err) {
                lockOk = false;
                console.error('ticket:close permission error:', err && err.message ? err.message : err);
            }
            if (!lockOk) {
                await btnReply('⚠️ تم إغلاق التكت، لكن البوت ما قدر يسكّر الروم. تأكد إن عنده صلاحية Manage Roles.').catch(() => {});
            }

            await setTicketMetaForChannel(channel, meta).catch((err) => {
                console.error('ticket:close meta error:', err && err.message ? err.message : err);
            });

            const embed = UI.embed({
                title: '🔒 تم إغلاق التكت',
                color: UI.COLORS.tickets,
                description: `اختار الإجراء من الأزرار تحت 👇${openDuration ? `\n\n> **مدة بقاء التكت مفتوح:** ${fmtDurationPretty(openDuration)}` : ''}`
            });

            const row = UI.row(
                UI.btn('ticket:reopen', '🔓 فتح', { style: ButtonStyle.Primary }),
                UI.btn('ticket:delete', '🗑️ حذف', { style: ButtonStyle.Danger }),
                UI.btn('ticket:archive', '📁 أرشفة', { style: ButtonStyle.Secondary }),
                UI.btn('ticket:set_archive', '📍 تحديد مكان الارشفة', { style: ButtonStyle.Secondary })
            );

            await channel.send({ embeds: [embed], components: [row] }).catch(() => {});

            // Log in background — fire & forget
            (async () => {
                try {
                    const logEmbed = UI.embed({
                        title: '🎫 تكت: تم الإغلاق',
                        color: UI.COLORS.tickets,
                        description: `${interaction.user} أغلق التكت: <#${channel.id}>`,
                        fields: openDuration ? [{ name: 'مدة بقاء التكت مفتوح', value: fmtDurationPretty(openDuration), inline: false }] : []
                    });
                    await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
                } catch {}
            })();
        })();

        return done;
    }

    if (action === 'reopen') {
        const ownerId = String(meta.ownerId || '');
        const prevClaimerId = meta.claimedBy ? String(meta.claimedBy) : '';
        meta.closed = false;
        meta.reopenedAt = Date.now();
        meta.reopenedBy = String(interaction.user.id);
        meta.openedAt = Date.now();
        meta.claimedBy = null;

        // INSTANT response
        const done = btnReply('🔓 تم فتح التكت مرة أخرى.');

        // Background work
        (async () => {
            // Permission edits — fire & forget
            (async () => {
                try {
                    const everyoneId = interaction.guild.roles.everyone.id;
                    const permissionOps = [
                        // Undo the blanket close lock; the opener's own
                        // overwrite below is what actually lets them talk.
                        channel.permissionOverwrites.edit(everyoneId, {
                            SendMessages: null, AddReactions: null,
                            CreatePublicThreads: null, CreatePrivateThreads: null
                        })
                    ];
                    if (ownerId) permissionOps.push(channel.permissionOverwrites.edit(ownerId, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true }));
                    for (const rid of staffRoleIds) {
                        permissionOps.push(channel.permissionOverwrites.edit(rid, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true }));
                    }
                    if (prevClaimerId) {
                        permissionOps.push(channel.permissionOverwrites.delete(prevClaimerId).catch(() => {}));
                    }
                    await Promise.all(permissionOps);
                } catch (err) {
                    console.error('ticket:reopen permission error:', err && err.message ? err.message : err);
                }
            })();

            await setTicketMetaForChannel(channel, meta).catch((err) => {
                console.error('ticket:reopen topic error:', err);
            });
            try {
                const logEmbed = UI.embed({
                    title: '🎫 تكت: إعادة فتح',
                    color: UI.COLORS.tickets,
                    description: `${interaction.user} أعاد فتح التكت: <#${channel.id}>`
                });
                await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
            } catch {}
        })();

        return done;
    }

    if (action === 'delete') {
        // INSTANT response
        const done = btnReply('🗑️ تم حذف التكت.');

        // Background work
        (async () => {
            // علّم صف التكت بالـ DB محذوفًا (الحالة بالـ DB هي المصدر الحقيقي)
            try {
                const ticketStore = require('../stores/ticketStore');
                ticketStore.updateTicket(channel.id, {
                    status: 'deleted',
                    closedAt: Date.now(),
                    closedBy: String(interaction.user.id)
                });
                // نظف صفوف التكتات المغلقة/المحذوفة الأقدم من 30 يوم
                ticketStore.pruneClosed(interaction.guild.id, 30 * 24 * 60 * 60 * 1000);
            } catch {
            }
            const logEmbed = UI.embed({
                title: '🎫 تكت: حذف',
                color: UI.COLORS.tickets,
                description: `${interaction.user} حذف التكت: <#${channel.id}>`
            });
            await Promise.all([
                sendGuildLog(interaction.guild, { embeds: [logEmbed] }).catch(() => {}),
                channel.delete('Ticket deleted').catch(() => {}),
            ]);
        })();

        return done;
    }

    if (action === 'archive') {
        const cfg = getGuildConfig(interaction.guild.id);
        const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
        const archiveChannelId = typeof tcfg.archiveChannelId === 'string' ? tcfg.archiveChannelId : null;
        if (!archiveChannelId) {
            return btnReply('لا يوجد مكان للأرشفة. استخدم زر (تحديد مكان الارشفة) أولاً 3:');
        }

        let archiveChannel;
        try {
            archiveChannel = await interaction.guild.channels.fetch(archiveChannelId);
        } catch {
            archiveChannel = null;
        }
        if (!archiveChannel || !archiveChannel.isTextBased()) {
            return btnReply('قناة الأرشفة غير صالحة… حدديها من جديد 3:');
        }

        const ownerId = String(meta.ownerId || '');
        const header = UI.embed({
            title: '📁 أرشفة تكت',
            color: UI.COLORS.tickets,
            description:
                `> **الروم:** <#${channel.id}>\n` +
                (ownerId ? `> **العضو:** <@${ownerId}>\n` : '') +
                (meta.typeName ? `> **النوع:** **${meta.typeName}**\n` : '')
        });

        const escapeHtml = (s) => String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const fetchAllMessages = async (ch, max = 5000) => {
            const out = [];
            let before;
            while (out.length < max) {
                let batch;
                try {
                    batch = await ch.messages.fetch({ limit: 100, before });
                } catch {
                    break;
                }
                if (!batch || batch.size === 0) break;
                const vals = [...batch.values()];
                out.push(...vals);
                before = vals[vals.length - 1].id;
                if (batch.size < 100) break;
            }
            return out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        };

        let messages = [];
        try {
            messages = await fetchAllMessages(channel);
        } catch {
            messages = [];
        }

        const guildName = interaction.guild ? interaction.guild.name : '';
        const channelName = String(channel.name || channel.id);

        const title = `Ticket Transcript - ${channelName}`;
        const headerHtml = `<!doctype html>
<html lang="ar">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#0b0f14; color:#e6edf3; margin:0; padding:24px; }
    .meta { background:#0f1720; border:1px solid #243042; border-radius:12px; padding:14px 16px; margin-bottom:16px; }
    .meta h1 { font-size:18px; margin:0 0 8px 0; }
    .meta div { opacity:0.9; font-size:13px; line-height:1.6; }
    .msg { display:flex; gap:12px; padding:10px 12px; border:1px solid #243042; border-radius:12px; margin:10px 0; background:#0f1720; }
    .avatar { width:40px; height:40px; border-radius:10px; background:#1f2a3a; flex:0 0 auto; }
    .content { flex:1; min-width:0; }
    .top { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
    .author { font-weight:700; }
    .time { font-size:12px; opacity:0.75; }
    .text { margin-top:6px; white-space:pre-wrap; word-break:break-word; }
    .attachments, .embeds { margin-top:8px; font-size:13px; opacity:0.95; }
    a { color:#7cc4ff; text-decoration:none; }
    a:hover { text-decoration:underline; }
    code { background:#0b0f14; padding:2px 6px; border-radius:8px; border:1px solid #243042; }
    .footer { margin-top:18px; font-size:12px; opacity:0.7; }
  </style>
</head>
<body>
  <div class="meta">
    <h1>${escapeHtml(title)}</h1>
    <div>Server: ${escapeHtml(guildName)}</div>
    <div>Channel: #${escapeHtml(channelName)} (${escapeHtml(channel.id)})</div>
    ${ownerId ? `<div>Owner: <code>${escapeHtml(ownerId)}</code></div>` : ''}
    ${meta.typeName ? `<div>Type: ${escapeHtml(meta.typeName)}</div>` : ''}
    <div>Exported at: ${escapeHtml(new Date().toISOString())}</div>
    <div>Total messages: ${escapeHtml(String(messages.length))}</div>
  </div>
`;

        const msgToHtml = (m) => {
            const when = new Date(m.createdTimestamp).toISOString();
            const authorTag = m.author ? m.author.tag : 'Unknown';
            const authorId = m.author ? m.author.id : '';
            const avatar = m.author && m.author.displayAvatarURL ? m.author.displayAvatarURL({ size: 64 }) : '';
            const content = String(m.content || '');

            const atts = m.attachments && m.attachments.size
                ? [...m.attachments.values()].map((a) => ({ name: a.name || 'file', url: a.url })).slice(0, 25)
                : [];

            const embeds = Array.isArray(m.embeds) && m.embeds.length
                ? m.embeds.slice(0, 3).map((e) => {
                    const t = e && e.title ? String(e.title) : '';
                    const d = e && e.description ? String(e.description) : '';
                    const u = e && e.url ? String(e.url) : '';
                    return { title: t, description: d, url: u };
                })
                : [];

            const attachmentsHtml = atts.length
                ? `<div class="attachments"><b>Attachments:</b><br/>${atts.map((a) => `- <a href="${escapeHtml(a.url)}" target="_blank">${escapeHtml(a.name)}</a>`).join('<br/>')}</div>`
                : '';

            const embedsHtml = embeds.length
                ? `<div class="embeds"><b>Embeds:</b><br/>${embeds.map((e) => {
                    const link = e.url ? ` <a href="${escapeHtml(e.url)}" target="_blank">(link)</a>` : '';
                    const title = e.title ? `<div><i>${escapeHtml(e.title)}</i>${link}</div>` : '';
                    const desc = e.description ? `<div>${escapeHtml(e.description).replace(/\n/g, '<br/>')}</div>` : '';
                    return `<div style="margin-top:6px; padding-left:8px; border-left:2px solid #243042;">${title}${desc}</div>`;
                }).join('')}</div>`
                : '';

            return `
  <div class="msg">
    <img class="avatar" src="${escapeHtml(avatar)}" alt="" onerror="this.style.display='none'" />
    <div class="content">
      <div class="top">
        <div class="author">${escapeHtml(authorTag)}${authorId ? ` <span style=\"opacity:.7;font-weight:400;\">(${escapeHtml(authorId)})</span>` : ''}</div>
        <div class="time">${escapeHtml(when)}</div>
      </div>
      <div class="text">${escapeHtml(content).replace(/\n/g, '<br/>')}</div>
      ${attachmentsHtml}
      ${embedsHtml}
    </div>
  </div>`;
        };

        const bodyHtml = messages.map(msgToHtml).join('\n');
        const footerHtml = `
  <div class="footer">Generated by Luna Bot</div>
</body>
</html>`;

        const html = headerHtml + bodyHtml + footerHtml;

        const maxBytes = 7.5 * 1024 * 1024;
        const buf = Buffer.from(html, 'utf8');

        const attachments = [];
        if (buf.length <= maxBytes) {
            attachments.push(new AttachmentBuilder(buf, { name: `ticket-${channel.id}.html` }));
        } else {
            const parts = Math.ceil(buf.length / maxBytes);
            for (let i = 0; i < parts; i++) {
                const slice = buf.subarray(i * maxBytes, Math.min(buf.length, (i + 1) * maxBytes));
                attachments.push(new AttachmentBuilder(slice, { name: `ticket-${channel.id}-part${i + 1}.html` }));
                if (attachments.length >= 5) break;
            }
        }

        try {
            await archiveChannel.send({ embeds: [header], files: attachments });
        } catch {
        }

        try {
            const logEmbed = UI.embed({
                title: '🎫 تكت: أرشفة',
                color: UI.COLORS.tickets,
                description: `${interaction.user} أرشف التكت: <#${channel.id}>\n> **المكان:** <#${archiveChannelId}>`
            });
            await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
        } catch {
        }

        await btnReply(`✅ تم أرشفة التكت كامل في: <#${archiveChannelId}>`);
        return;
    }

    return btnReply('آسف بس خيار غير معروف 3:');
}

async function handle({ client, interaction }) {
    try {
        if (!interaction || typeof interaction.customId !== 'string') return false;

        if (interaction.isButton() && interaction.customId.startsWith('ticketsui:')) {
            await handleTicketsUi({ client, interaction });
            return true;
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticketsSelect:')) {
            await handleTicketsSelect({ interaction });
            return true;
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'ticketsPanel:open') {
            await handleTicketsPanelOpen({ client, interaction });
            return true;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticketsModal:')) {
            await handleTicketsModal({ interaction });
            return true;
        }

        if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
            try {
                await handleTicketButtons({ client, interaction });
            } catch (err) {
                console.error('ticket handler error:', err);
                ticketReply(interaction, 'صار خطأ أثناء معالجة طلبك 3:').catch(() => {});
            }
            return true;
        }

        return false;
    } catch (err) {
        console.error('tickets handler failed:', err);
        try {
            if (interaction && !interaction.replied && !interaction.deferred) {
                interaction.reply({ content: 'صار خطأ أثناء معالجة طلبك 3:', flags: MessageFlags.Ephemeral }).catch(() => {});
            } else if (interaction) {
                interaction.followUp({ content: 'صار خطأ أثناء معالجة طلبك 3:', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        } catch {
            // ignore
        }
        return false;
    }
}

// Re-export the service builders (kept for backward-compat: consumers may pull
// them from either ticketsService or this handler).
module.exports = {
    handle,
    normalizeTicketTypeId,
    getTicketMetaFromChannel,
    setTicketMetaForChannel,
    fmtMsShort,
    fmtDurationPretty,
    parseDurationLike
};
