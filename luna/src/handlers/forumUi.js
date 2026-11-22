const { PermissionsBitField, ButtonStyle, ButtonBuilder } = require('discord.js');

const { THEME } = require('../utils/theme');
const { logError } = require('../utils/log');
const { replyEphemeral, deferUpdateSafe } = require('../utils/respond');

async function handleForumModalCreate({ client, interaction }) {
    if (!(interaction.isModalSubmit && interaction.isModalSubmit())) return false;
    if (interaction.customId !== 'forumModal:create') return false;

    if (!interaction.guild) {
        try {
            await interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });
        } catch {
        }
        return true;
    }

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
        try {
            await interaction.reply({ content: 'اسفة بس ما عندك صلاحية Manage Messages عشان تستعمل هاد الامر 3:' });
        } catch {
        }
        return true;
    }

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }
    } catch {
    }

    const { EmbedBuilder, ChannelType } = require('discord.js');
    const title = String(interaction.fields.getTextInputValue('title') || '').trim();
    const description = String(interaction.fields.getTextInputValue('description') || '').trim();
    const rawColor = String(interaction.fields.getTextInputValue('color') || '').trim();

    if (!title || !description) {
        try {
            await interaction.editReply({ content: 'اسفة بس لازم تعبي العنوان والوصف 3:' });
        } catch {
        }
        return true;
    }

    const defaultColor = '#E7D3B0';
    const normalized = rawColor.startsWith('#') ? rawColor : (rawColor ? `#${rawColor}` : '');
    const validColor = /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : defaultColor;

    const embed = new EmbedBuilder()
        .setColor(validColor)
        .setTitle(title.slice(0, 256))
        .setDescription(description.slice(0, 4000))
        .setTimestamp();

    const formatMissingPerms = (missing) => {
        if (!missing || missing.length === 0) return null;
        const lines = missing.map((p) => `- ${p}`).join('\n');
        return `اسفة بس ما عندي الصلاحيات الكافية بهالقناة 😭\n\nالصلاحيات الناقصة:\n${lines}`;
    };

    try {
        const channel = interaction.channel;
        if (!channel) {
            return await interaction.editReply({ content: 'اسفة بس ما قدرت أحدد القناة اللي انت فيها 3:' });
        }

        const me = interaction.guild.members.me;
        if (!me) {
            return await interaction.editReply({ content: 'اسفة بس ما قدرت أحدد حساب البوت بالسيرفر 3:' });
        }

        const permsHere = channel.permissionsFor(me);
        if (!permsHere || !permsHere.has(PermissionsBitField.Flags.ViewChannel)) {
            return await interaction.editReply({ content: 'اسفة بس ما عندي صلاحية View Channel بهالقناة 3:' });
        }

        if (channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia) {
            const needed = [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.CreatePublicThreads
            ];
            const missing = channel.permissionsFor(me)?.missing(needed) || [];
            const msg = formatMissingPerms(missing);
            if (msg) return await interaction.editReply({ content: msg });

            const thread = await channel.threads.create({
                name: title.slice(0, 100),
                message: { embeds: [embed] }
            });
            return await interaction.editReply({ content: `✅ تم! سويت بوست بالفورم: <#${thread.id}>` });
        }

        const isThread = channel.isThread?.() === true;
        if (isThread) {
            const needed = [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessagesInThreads,
                PermissionsBitField.Flags.EmbedLinks
            ];
            const missing = channel.permissionsFor(me)?.missing(needed) || [];
            const msg = formatMissingPerms(missing);
            if (msg) return await interaction.editReply({ content: msg });
        } else {
            const needed = [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks
            ];
            const missing = channel.permissionsFor(me)?.missing(needed) || [];
            const msg = formatMissingPerms(missing);
            if (msg) return await interaction.editReply({ content: msg });
        }

        await channel.send({ embeds: [embed] });
        return await interaction.editReply({ content: '✅ تم! نزلت الإيمبد هنا ✨' });
    } catch (err) {
        logError('forumModal:create', err?.code || err);
        try {
            await interaction.editReply({ content: 'اسفة بس صار خطأ وأنا أرسل الإيمبد… عطيني لوق الكونسل/الترمنل اللي طلع عشان أحدد السبب 3:' });
        } catch {
        }
        return true;
    }
}

async function handleForumUiButtons({ client, interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('forumui:'))) return false;

    if (!interaction.guild) {
        await replyEphemeral(interaction, { content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });
        return true;
    }

    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ChannelType } = require('discord.js');
    const parts = interaction.customId.split(':');
    const action = parts[1] || '';
    const ownerId = parts[2] || '';
    const postId = parts[3] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        await replyEphemeral(interaction, { content: 'اسفة بس هاللوحة لصاحبها بس 3:' });
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
        await replyEphemeral(interaction, { content: 'اسفة بس تحتاج صلاحية Manage Messages عشان تستخدم هالامر 3:' });
        return true;
    }

    const forumUi = require('../forumUi');
    const forumCmd = client.commands.get('forum');
    const draft = forumUi.getDraft(postId);
    if (!forumCmd || !draft) {
        await replyEphemeral(interaction, { content: 'اسفة بس ما لقيت المسودة… ممكن انتهت/انحذفت 3:' });
        return true;
    }

    const updatePreview = async () => {
        const nextDraft = forumUi.getDraft(postId);
        if (!nextDraft) return;
        const embed = forumCmd.buildDraftPreviewEmbed(nextDraft, interaction.user.tag);
        const components = forumCmd.buildForumUiRows(interaction.user.id, nextDraft.postId);
        try {
            return await interaction.update({ content: '🧾 مسودة /forum', embeds: [embed], components });
        } catch {
            return;
        }
    };

    if (action === 'edit_embed') {
        const modal = new ModalBuilder()
            .setCustomId(`forumuiModal:edit_embed:${ownerId}:${postId}`)
            .setTitle('تعديل الإيمبد');

        const title = new TextInputBuilder()
            .setCustomId('title')
            .setLabel('العنوان')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(256)
            .setValue(String(draft.embed?.title || '').slice(0, 256));

        const desc = new TextInputBuilder()
            .setCustomId('description')
            .setLabel('الوصف')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000)
            .setValue(String(draft.embed?.description || '').slice(0, 4000));

        const color = new TextInputBuilder()
            .setCustomId('color')
            .setLabel('لون Hex اختياري (#E7D3B0)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10)
            .setValue(String(draft.embed?.color || '').slice(0, 10));

        const image = new TextInputBuilder()
            .setCustomId('image')
            .setLabel('رابط صورة (اختياري)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(300)
            .setValue(String(draft.embed?.image || '').slice(0, 300));

        const thumbnail = new TextInputBuilder()
            .setCustomId('thumbnail')
            .setLabel('رابط ثمبنيل (اختياري)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(300)
            .setValue(String(draft.embed?.thumbnail || '').slice(0, 300));

        modal.addComponents(
            new ActionRowBuilder().addComponents(title),
            new ActionRowBuilder().addComponents(desc),
            new ActionRowBuilder().addComponents(color),
            new ActionRowBuilder().addComponents(image),
            new ActionRowBuilder().addComponents(thumbnail)
        );
        try {
            return await interaction.showModal(modal).then(() => true);
        } catch {
            await replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أفتح الفورم 3:' });
            return true;
        }
    }

    // Simplified builder: one popup per button — name, colour, content.
    if (action === 'add_simple') {
        const modal = new ModalBuilder()
            .setCustomId(`forumuiModal:add_simple:${ownerId}:${postId}`)
            .setTitle('إضافة زر');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('label')
                    .setLabel('اسم الزر')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(80)
                    .setPlaceholder('مثال: القوانين')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('style')
                    .setLabel('اللون: ازرق / اخضر / احمر / رمادي')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(20)
                    .setValue('رمادي')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('response')
                    .setLabel('شو يظهر لما العضو يضغط؟')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(3500)
                    .setPlaceholder('اكتب النص اللي بيظهر للعضو...')
            )
        );

        try {
            await interaction.showModal(modal);
        } catch {
            await replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أفتح الفورم 3:' });
        }
        return true;
    }

    if (action === 'add_button') {
        const modal = new ModalBuilder()
            .setCustomId(`forumuiModal:add_button:${ownerId}:${postId}`)
            .setTitle('إضافة زر');

        const label = new TextInputBuilder()
            .setCustomId('label')
            .setLabel('اسم الزر (مثال: القوانين)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80);

        const style = new TextInputBuilder()
            .setCustomId('style')
            .setLabel('لون الزر (اختياري: ازرق/اخضر/احمر/رمادي)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(20)
            .setValue('رمادي');

        const options = new TextInputBuilder()
            .setCustomId('options')
            .setLabel('الخيارات والردود (كل سطر: خيار => الرد)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(3500)
            .setValue(
                '📌 كيف ادخل الفعالية؟ => ادخل روم الفعاليات واضغط مشاركة\n' +
                '🎁 كيف استلم الجائزة؟ => تواصل مع الستاف بعد الفوز\n' +
                '🚫 ممنوعات => ممنوع سبام/منشنات كثيرة'
            );

        modal.addComponents(
            new ActionRowBuilder().addComponents(label),
            new ActionRowBuilder().addComponents(style),
            new ActionRowBuilder().addComponents(options)
        );

        try {
            return await interaction.showModal(modal).then(() => true);
        } catch {
            await replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أفتح الفورم 3:' });
            return true;
        }
    }

    if (action === 'clear_buttons') {
        forumUi.updateDraft(postId, { buttons: [] });
        await updatePreview();
        return true;
    }

    if (action === 'templates') {
        const forumTemplates = require('../forumTemplates');
        const list = forumTemplates.listTemplates();
        const options = list.slice(0, 25).map((t) => ({
            label: String(t.label || t.id).slice(0, 100),
            description: String(t.description || '').slice(0, 100),
            value: String(t.id)
        }));

        const embed = new EmbedBuilder()
            .setColor(THEME.embedColor)
            .setTitle('🧩 قوالب جاهزة')
            .setDescription('اختار قالب جاهز، وبعدها تقدر تعدل عليه براحتك ✨');

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`forumuiSelect:template:${ownerId}:${postId}`)
                .setPlaceholder('اختار قالب...')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(options)
        );

        try {
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        } catch {
            try {
                await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
            } catch {
            }
        }
        return true;
    }

    if (action === 'preview') {
        const draftNow = forumUi.getDraft(postId);
        if (!draftNow) {
            await replyEphemeral(interaction, { content: 'اسفة بس ما لقيت المسودة… ممكن انتهت/انحذفت 3:' });
            return true;
        }

        const buttons = Array.isArray(draftNow.buttons) ? draftNow.buttons : [];
        if (buttons.length > 5) {
            await replyEphemeral(interaction, { content: 'اسفة بس الحد الأقصى 5 أزرار 3:' });
            return true;
        }

        const normalizedColor = forumUi.normalizeHexColor(draftNow.embed?.color);
        const image = draftNow && draftNow.embed && typeof draftNow.embed.image === 'string' ? draftNow.embed.image.trim() : '';
        const thumbnail = draftNow && draftNow.embed && typeof draftNow.embed.thumbnail === 'string' ? draftNow.embed.thumbnail.trim() : '';

        const embed = new EmbedBuilder()
            .setColor(normalizedColor)
            .setTitle(String(draftNow.embed?.title || '').slice(0, 256))
            .setDescription(String(draftNow.embed?.description || '').slice(0, 4000))
            .setTimestamp();

        if (image && /^https?:\/\//i.test(image)) {
            try { embed.setImage(image); } catch { }
        }
        if (thumbnail && /^https?:\/\//i.test(thumbnail)) {
            try { embed.setThumbnail(thumbnail); } catch { }
        }

        const components = [];
        if (buttons.length) {
            const row = new ActionRowBuilder();
            for (let i = 0; i < Math.min(5, buttons.length); i += 1) {
                const b = buttons[i] || {};
                const styleKey = String(b.style || 'Secondary');
                const styleMap = {
                    Primary: ButtonStyle.Primary,
                    Secondary: ButtonStyle.Secondary,
                    Success: ButtonStyle.Success,
                    Danger: ButtonStyle.Danger
                };
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`forumPost:${postId}:btn:${i}`)
                        .setLabel(String(b.label || `زر ${i + 1}`).slice(0, 80))
                        .setStyle(styleMap[styleKey] || ButtonStyle.Secondary)
                );
            }
            components.push(row);
        }

        try {
            await interaction.reply({ content: '✨ هذي معاينة قبل النشر:', embeds: [embed], components, ephemeral: true });
        } catch {
            try {
                await interaction.followUp({ content: '✨ هذي معاينة قبل النشر:', embeds: [embed], components, ephemeral: true });
            } catch {
            }
        }
        return true;
    }

    if (action === 'cancel') {
        forumUi.deleteDraft(postId);
        try {
            await interaction.update({ content: '✅ تم إلغاء المسودة.', embeds: [], components: [] });
        } catch {
        }
        return true;
    }

    if (action === 'publish') {
        const draftNow = forumUi.getDraft(postId);
        if (!draftNow) {
            await replyEphemeral(interaction, { content: 'اسفة بس ما لقيت المسودة… ممكن انتهت/انحذفت 3:' });
            return true;
        }

        const buttons = Array.isArray(draftNow.buttons) ? draftNow.buttons : [];
        if (buttons.length > 5) {
            await replyEphemeral(interaction, { content: 'اسفة بس الحد الأقصى 5 أزرار 3:' });
            return true;
        }

        const normalizedColor = forumUi.normalizeHexColor(draftNow.embed?.color);
        const image = draftNow && draftNow.embed && typeof draftNow.embed.image === 'string' ? draftNow.embed.image.trim() : '';
        const thumbnail = draftNow && draftNow.embed && typeof draftNow.embed.thumbnail === 'string' ? draftNow.embed.thumbnail.trim() : '';
        const embed = new EmbedBuilder()
            .setColor(normalizedColor)
            .setTitle(String(draftNow.embed?.title || '').slice(0, 256))
            .setDescription(String(draftNow.embed?.description || '').slice(0, 4000))
            .setTimestamp();

        if (image && /^https?:\/\//i.test(image)) {
            try { embed.setImage(image); } catch { }
        }
        if (thumbnail && /^https?:\/\//i.test(thumbnail)) {
            try { embed.setThumbnail(thumbnail); } catch { }
        }

        const components = [];
        if (buttons.length) {
            const row = new ActionRowBuilder();
            for (let i = 0; i < Math.min(5, buttons.length); i += 1) {
                const b = buttons[i] || {};
                const styleKey = String(b.style || 'Secondary');
                const styleMap = {
                    Primary: ButtonStyle.Primary,
                    Secondary: ButtonStyle.Secondary,
                    Success: ButtonStyle.Success,
                    Danger: ButtonStyle.Danger
                };
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`forumPost:${postId}:btn:${i}`)
                        .setLabel(String(b.label || `زر ${i + 1}`).slice(0, 80))
                        .setStyle(styleMap[styleKey] || ButtonStyle.Secondary)
                );
            }
            components.push(row);
        }

        const formatMissingPerms = (missing) => {
            if (!missing || missing.length === 0) return null;
            const lines = missing.map((p) => `- ${p}`).join('\n');
            return `اسفة بس ما عندي الصلاحيات الكافية بهالقناة 😭\n\nالصلاحيات الناقصة:\n${lines}`;
        };

        try {
            const channel = interaction.channel;
            if (!channel) {
                await replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أحدد القناة اللي انت فيها 3:' });
                return true;
            }

            const me = interaction.guild.members.me;
            if (!me) {
                await replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أحدد حساب البوت بالسيرفر 3:' });
                return true;
            }

            const permsHere = channel.permissionsFor(me);
            if (!permsHere || !permsHere.has(PermissionsBitField.Flags.ViewChannel)) {
                await replyEphemeral(interaction, { content: 'اسفة بس ما عندي صلاحية View Channel بهالقناة 3:' });
                return true;
            }

            let sentMessage = null;
            if (channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia) {
                const needed = [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.EmbedLinks,
                    PermissionsBitField.Flags.CreatePublicThreads
                ];
                const missing = channel.permissionsFor(me)?.missing(needed) || [];
                const msg = formatMissingPerms(missing);
                if (msg) {
                    await replyEphemeral(interaction, { content: msg });
                    return true;
                }

                const thread = await channel.threads.create({
                    name: String(draftNow.embed?.title || 'post').slice(0, 100),
                    message: { embeds: [embed], components }
                });
                sentMessage = await thread.fetchStarterMessage().catch(() => null);

                forumUi.savePublishedPost({
                    postId,
                    guildId: interaction.guild.id,
                    channelId: String(channel.id),
                    messageId: sentMessage ? String(sentMessage.id) : String(thread.id),
                    createdBy: interaction.user.id,
                    data: { embed: draftNow.embed, buttons }
                });

                forumUi.deleteDraft(postId);
                try {
                    await interaction.update({ content: `✅ تم! سويت بوست بالفورم: <#${thread.id}>`, embeds: [], components: [] });
                } catch {
                }
                return true;
            }

            const isThread = channel.isThread?.() === true;
            if (isThread) {
                const needed = [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessagesInThreads,
                    PermissionsBitField.Flags.EmbedLinks
                ];
                const missing = channel.permissionsFor(me)?.missing(needed) || [];
                const msg = formatMissingPerms(missing);
                if (msg) {
                    await replyEphemeral(interaction, { content: msg });
                    return true;
                }
            } else {
                const needed = [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.EmbedLinks
                ];
                const missing = channel.permissionsFor(me)?.missing(needed) || [];
                const msg = formatMissingPerms(missing);
                if (msg) {
                    await replyEphemeral(interaction, { content: msg });
                    return true;
                }
            }

            sentMessage = await channel.send({ embeds: [embed], components });
            forumUi.savePublishedPost({
                postId,
                guildId: interaction.guild.id,
                channelId: String(channel.id),
                messageId: String(sentMessage.id),
                createdBy: interaction.user.id,
                data: { embed: draftNow.embed, buttons }
            });

            forumUi.deleteDraft(postId);
            try {
                await interaction.update({ content: '✅ تم! نزلت المنشور هنا.', embeds: [], components: [] });
            } catch {
            }
        } catch (err) {
            logError('forumui:publish', err?.code || err);
            await replyEphemeral(interaction, { content: 'اسفة بس صار خطأ وأنا أنشر… عطيني لوق الكونسل/الترمنل 3:' });
        }
        return true;
    }

    await replyEphemeral(interaction, { content: 'اسفة بس ما فهمت 3:' });
    return true;
}

async function handleForumUiModal({ client, interaction }) {
    if (!(interaction.isModalSubmit && interaction.isModalSubmit())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('forumuiModal:'))) return false;

    if (!interaction.guild) {
        await replyEphemeral(interaction, { content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });
        return true;
    }

    const parts = interaction.customId.split(':');
    const kind = parts[1] || '';
    const ownerId = parts[2] || '';
    const postId = parts[3] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        await replyEphemeral(interaction, { content: 'اسفة بس هاللوحة لصاحبها بس 3:' });
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
        await replyEphemeral(interaction, { content: 'اسفة بس تحتاج صلاحية Manage Messages عشان تستخدم هالامر 3:' });
        return true;
    }

    const forumUi = require('../forumUi');
    const forumCmd = client.commands.get('forum');
    const draft = forumUi.getDraft(postId);
    if (!forumCmd || !draft) {
        await replyEphemeral(interaction, { content: 'اسفة بس ما لقيت المسودة… ممكن انتهت/انحذفت 3:' });
        return true;
    }

    if (kind === 'edit_embed') {
        const title = String(interaction.fields.getTextInputValue('title') || '').trim();
        const description = String(interaction.fields.getTextInputValue('description') || '').trim();
        const color = String(interaction.fields.getTextInputValue('color') || '').trim();
        const image = String(interaction.fields.getTextInputValue('image') || '').trim();
        const thumbnail = String(interaction.fields.getTextInputValue('thumbnail') || '').trim();
        if (!title || !description) {
            await replyEphemeral(interaction, { content: 'اسفة بس لازم تعبي العنوان والوصف 3:' });
            return true;
        }

        forumUi.updateDraft(postId, {
            embed: {
                title: title.slice(0, 256),
                description: description.slice(0, 4000),
                color,
                image: image.slice(0, 300),
                thumbnail: thumbnail.slice(0, 300)
            }
        });

        const next = forumUi.getDraft(postId);
        const embed = forumCmd.buildDraftPreviewEmbed(next, interaction.user.tag);
        const components = forumCmd.buildForumUiRows(interaction.user.id, postId);
        await replyEphemeral(interaction, { content: '✅ تم تحديث المسودة.', embeds: [embed], components });
        return true;
    }

    if (kind === 'add_simple') {
        const label = String(interaction.fields.getTextInputValue('label') || '').trim();
        const style = forumUi.parseButtonStyle(interaction.fields.getTextInputValue('style'));
        const response = String(interaction.fields.getTextInputValue('response') || '').trim();
        if (!label || !response) {
            await replyEphemeral(interaction, { content: 'لازم تكتب اسم الزر واللي يظهر 3:' });
            return true;
        }
        const buttons = Array.isArray(draft.buttons) ? [...draft.buttons] : [];
        if (buttons.length >= 5) {
            await replyEphemeral(interaction, { content: 'الحد الأقصى 5 أزرار 3:' });
            return true;
        }
        buttons.push({ label: label.slice(0, 80), style, options: [{ label: label.slice(0, 80), response: response.slice(0, 1900) }] });
        forumUi.updateDraft(postId, { buttons });

        const next = forumUi.getDraft(postId);
        const embed = forumCmd.buildDraftPreviewEmbed(next, interaction.user.tag);
        const components = forumCmd.buildForumUiRows(interaction.user.id, postId);
        await replyEphemeral(interaction, { content: `✅ تمت إضافة الزر **${label.slice(0, 80)}**.`, embeds: [embed], components });
        return true;
    }

    if (kind === 'add_button') {
        const label = String(interaction.fields.getTextInputValue('label') || '').trim();
        const styleRaw = String(interaction.fields.getTextInputValue('style') || '').trim();
        const optionsRaw = String(interaction.fields.getTextInputValue('options') || '').trim();

        if (!label) {
            await replyEphemeral(interaction, { content: 'اسفة بس اسم الزر مطلوب 3:' });
            return true;
        }
        const options = forumUi.parseButtonOptions(optionsRaw);
        if (!options.length) {
            await replyEphemeral(interaction, { content: 'اسفة بس لازم تكتب خيارات بصيغة label => الرد 3:' });
            return true;
        }

        const buttons = Array.isArray(draft.buttons) ? [...draft.buttons] : [];
        if (buttons.length >= 5) {
            await replyEphemeral(interaction, { content: 'اسفة بس الحد الأقصى 5 أزرار 3:' });
            return true;
        }

        buttons.push({
            label: label.slice(0, 80),
            style: forumUi.parseButtonStyle(styleRaw),
            options
        });

        forumUi.updateDraft(postId, { buttons });

        const next = forumUi.getDraft(postId);
        const embed = forumCmd.buildDraftPreviewEmbed(next, interaction.user.tag);
        const components = forumCmd.buildForumUiRows(interaction.user.id, postId);
        await replyEphemeral(interaction, { content: '✅ تمت إضافة الزر.', embeds: [embed], components });
        return true;
    }

    await replyEphemeral(interaction, { content: 'اسفة بس ما فهمت 3:' });
    return true;
}

async function handleForumUiTemplateSelect({ client, interaction }) {
    if (!(interaction.isStringSelectMenu && interaction.isStringSelectMenu())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('forumuiSelect:template:'))) return false;

    if (!interaction.guild) return true;

    const parts = interaction.customId.split(':');
    const ownerId = parts[2] || '';
    const postId = parts[3] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        await replyEphemeral(interaction, { content: 'اسفة بس هالقائمة لصاحب الأمر بس 3:' });
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
        await replyEphemeral(interaction, { content: 'اسفة بس تحتاج صلاحية Manage Messages عشان تستخدم هالامر 3:' });
        return true;
    }

    await deferUpdateSafe(interaction);

    const selection = Array.isArray(interaction.values) && interaction.values[0] ? String(interaction.values[0]) : '';
    if (!selection) {
        await replyEphemeral(interaction, { content: 'اسفة بس ما فهمت اختيارك 3:' });
        return true;
    }

    const forumUi = require('../forumUi');
    const forumCmd = client.commands.get('forum');
    const draft = forumUi.getDraft(postId);
    if (!forumCmd || !draft) {
        await replyEphemeral(interaction, { content: 'اسفة بس ما لقيت المسودة… ممكن انتهت/انحذفت 3:' });
        return true;
    }

    const forumTemplates = require('../forumTemplates');
    const patch = forumTemplates.applyTemplateToDraft(draft, selection);
    if (!patch) {
        await replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أطبق القالب… جرّب قالب ثاني 3:' });
        return true;
    }

    forumUi.updateDraft(postId, patch);

    const nextDraft = forumUi.getDraft(postId);
    const embed = forumCmd.buildDraftPreviewEmbed(nextDraft, interaction.user.tag);
    const components = forumCmd.buildForumUiRows(interaction.user.id, nextDraft.postId);

    try {
        await interaction.editReply({ content: '✅ تم تطبيق القالب! تقدر تعدل عليه براحتك ✨', embeds: [embed], components });
    } catch {
    }
    return true;
}

async function handle({ client, interaction }) {
    try {
        if (await handleForumUiTemplateSelect({ client, interaction })) return true;
        if (await handleForumModalCreate({ client, interaction })) return true;
        if (await handleForumUiButtons({ client, interaction })) return true;
        if (await handleForumUiModal({ client, interaction })) return true;
        return false;
    } catch (err) {
        logError('handlers/forumUi', err);
        return false;
    }
}

module.exports = { handle };
