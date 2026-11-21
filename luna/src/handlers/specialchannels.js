const {
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

function isOwner(interaction, ownerId) {
    return String(interaction.user.id) === String(ownerId);
}
async function denyNotOwner(interaction) {
    try {
        if (interaction.deferred || interaction.replied) return await interaction.followUp({ content: 'هاللوحة مو مالك 3:', flags: MessageFlags.Ephemeral });
        return await interaction.reply({ content: 'هاللوحة مو مالك 3:', flags: MessageFlags.Ephemeral });
    } catch { return null; }
}

function buildNomsgPanel(guildId, guild) {
    const cfg = getGuildConfig(guildId);
    const list = Array.isArray(cfg.noMsgChannels) ? cfg.noMsgChannels : [];
    const lines = list.length
        ? list.map((id) => {
            const ch = guild.channels.cache.get(id);
            return ch ? `<#${id}> (${ch.name})` : `<#${id}>`;
        }).join('\n')
        : 'ما فيه قنوات مفعل فيها منع الرسائل.';
    const embed = new EmbedBuilder()
        .setColor('#E7D3B0')
        .setTitle('🚫 منع الرسائل')
        .setDescription(lines.slice(0, 4000));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('specialchannels:nomsg:add').setLabel('➕ إضافة').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('specialchannels:nomsg:remove').setLabel('➖ حذف').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('specialchannels:nomsg:list').setLabel('📋 قائمة').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

function buildNoimagesPanel(guildId, guild) {
    const cfg = getGuildConfig(guildId);
    const list = Array.isArray(cfg.noImageChannels) ? cfg.noImageChannels : [];
    const lines = list.length
        ? list.map((id) => {
            const ch = guild.channels.cache.get(id);
            return ch ? `<#${id}> (${ch.name})` : `<#${id}>`;
        }).join('\n')
        : 'ما فيه قنوات مفعل فيها منع الصور.';
    const embed = new EmbedBuilder()
        .setColor('#E7D3B0')
        .setTitle('🖼️ منع الصور')
        .setDescription(lines.slice(0, 4000));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('specialchannels:noimages:add').setLabel('➕ إضافة').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('specialchannels:noimages:remove').setLabel('➖ حذف').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('specialchannels:noimages:list').setLabel('📋 قائمة').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

function keyForSection(section) {
    if (section === 'nomsg') return 'noMsgChannels';
    if (section === 'noimages') return 'noImageChannels';
    if (section === 'honeypot') return 'honeypotChannelIds';
    return null;
}

function labelForSection(section) {
    if (section === 'nomsg') return 'منع الرسائل';
    if (section === 'noimages') return 'منع الصور';
    if (section === 'honeypot') return 'هوني بوت 🍯 (حظر فوري)';
    return 'القناة';
}

function buildHoneypotPanel(guildId, guild) {
    const cfg = getGuildConfig(guildId);
    const list = Array.isArray(cfg.honeypotChannelIds) ? cfg.honeypotChannelIds : [];
    const lines = list.length
        ? list.map((id) => {
            const ch = guild.channels.cache.get(id);
            return ch ? `<#${id}> (${ch.name})` : `<#${id}>`;
        }).join('\n')
        : 'ما فيه قنوات هوني بوت مفعّلة.';
    const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🍯 هوني بوت — حظر فوري')
        .setDescription('أي رسالة من أي عضو في هالقنوات بتسوي **بان** فوري للكاتب (الإدارة مستثناة).\n\n' + lines.slice(0, 4000));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('specialchannels:honeypot:add').setLabel('➕ إضافة').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('specialchannels:honeypot:remove').setLabel('➖ حذف').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('specialchannels:honeypot:list').setLabel('📋 قائمة').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

async function handle({ client, interaction }) {
    if (!interaction.guild) return false;
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return false;
    if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith('specialchannels')) return false;

    const id = interaction.customId;

    // ====== MODAL SUBMISSIONS ======
    if (interaction.isModalSubmit()) {
        if (!id.startsWith('specialchannelsModal:')) return false;
        const modalParts = id.split(':');
        const modalSection = modalParts[1]; // nomsg | noimages
        const modalAction = modalParts[2];  // add
        if (modalAction === 'add') {
            const raw = interaction.fields.getTextInputValue('channelid').trim();
            const channelId = raw.replace(/^<#(\d+)>$/, '$1').trim();
            if (!/^\d{15,20}$/.test(channelId)) {
                await interaction.reply({ content: '❌ اكتب ID قناة صحيح (أرقام فقط من 15 إلى 20 خانة) 3:', flags: MessageFlags.Ephemeral });
                return true;
            }
            const key = keyForSection(modalSection);
            if (!key) return false;
            const cfg = getGuildConfig(interaction.guild.id);
            const list = Array.isArray(cfg[key]) ? [...cfg[key]] : [];
            if (!list.includes(channelId)) list.push(channelId);
            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, [key]: list }));
            const label = labelForSection(modalSection);
            await interaction.reply({ content: `✅ تم تفعيل **${label}** في <#${channelId}>`, flags: MessageFlags.Ephemeral });
            return true;
        }
        return false;
    }

    // ====== SELECT MENUS ======
    if (interaction.isStringSelectMenu()) {
        if (!id.startsWith('specialchannelsSelect:')) return false;
        const selParts = id.split(':');
        const selSection = selParts[1]; // nomsg | noimages
        const channelId = interaction.values[0];
        const key = keyForSection(selSection);
        if (!key) return false;
        const cfg = getGuildConfig(interaction.guild.id);
        const list = Array.isArray(cfg[key]) ? cfg[key] : [];
        const filtered = list.filter((chId) => chId !== channelId);
        if (filtered.length === list.length) {
            await interaction.reply({ content: 'هالقناة مو موجودة بالقائمة 3:', flags: MessageFlags.Ephemeral });
            return true;
        }
        updateGuildConfig(interaction.guild.id, (c) => ({ ...c, [key]: filtered }));
        const label = labelForSection(selSection);
        await interaction.reply({ content: `✅ تم إلغاء **${label}** في <#${channelId}>`, flags: MessageFlags.Ephemeral });
        return true;
    }

    // ====== BUTTONS ======
    if (!interaction.isButton()) return false;

    const parts = id.split(':');
    if (parts.length < 3) return false;
    const section = parts[1]; // nomsg | noimages | list
    const action = parts[2];  // menu | add | remove | list | confirm

    // Menu buttons from main panel
    if (action === 'menu') {
        const ownerId = parts[3];
        if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
        if (section === 'nomsg') {
            await interaction.reply({ ...buildNomsgPanel(interaction.guild.id, interaction.guild), flags: MessageFlags.Ephemeral });
            return true;
        }
        if (section === 'noimages') {
            await interaction.reply({ ...buildNoimagesPanel(interaction.guild.id, interaction.guild), flags: MessageFlags.Ephemeral });
            return true;
        }
        if (section === 'honeypot') {
            await interaction.reply({ ...buildHoneypotPanel(interaction.guild.id, interaction.guild), flags: MessageFlags.Ephemeral });
            return true;
        }
        return false;
    }

    if (section === 'list' && action === 'all') {
        const ownerId = parts[3];
        if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
        const cfg = getGuildConfig(interaction.guild.id);
        const nomsgList = Array.isArray(cfg.noMsgChannels) ? cfg.noMsgChannels : [];
        const noimgList = Array.isArray(cfg.noImageChannels) ? cfg.noImageChannels : [];
        const honeyList = Array.isArray(cfg.honeypotChannelIds) ? cfg.honeypotChannelIds : [];
        const guild = interaction.guild;
        const nomsgLines = nomsgList.length
            ? nomsgList.map((id) => {
                const ch = guild.channels.cache.get(id);
                return ch ? `<#${id}> (${ch.name})` : `<#${id}>`;
            }).join('\n')
            : '—';
        const noimgLines = noimgList.length
            ? noimgList.map((id) => {
                const ch = guild.channels.cache.get(id);
                return ch ? `<#${id}> (${ch.name})` : `<#${id}>`;
            }).join('\n')
            : '—';
        const honeyLines = honeyList.length
            ? honeyList.map((id) => {
                const ch = guild.channels.cache.get(id);
                return ch ? `<#${id}> (${ch.name})` : `<#${id}>`;
            }).join('\n')
            : '—';
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('📋 القنوات الخاصة')
            .addFields(
                { name: '🚫 منع الرسائل', value: nomsgLines || '—', inline: false },
                { name: '🖼️ منع الصور', value: noimgLines || '—', inline: false },
                { name: '🍯 هوني بوت (حظر)', value: honeyLines || '—', inline: false }
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return true;
    }

    // ADD buttons → modal
    if (action === 'add') {
        const modal = new ModalBuilder().setCustomId(`specialchannelsModal:${section}:add`).setTitle(`إضافة قناة: ${labelForSection(section)}`);
        const input = new TextInputBuilder().setCustomId('channelid').setLabel('ID القناة').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('123456789012345678');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return true;
    }

    // REMOVE buttons → select menu
    if (action === 'remove') {
        const cfg = getGuildConfig(interaction.guild.id);
        const key = keyForSection(section);
        if (!key) return false;
        const list = Array.isArray(cfg[key]) ? cfg[key] : [];
        if (list.length === 0) {
            await interaction.reply({ content: `ما فيه قنوات لـ ${labelForSection(section)} 3:`, flags: MessageFlags.Ephemeral });
            return true;
        }
        const guild = interaction.guild;
        const options = list.slice(0, 25).map((chId) => {
            const ch = guild.channels.cache.get(chId);
            return {
                label: ch ? ch.name : chId,
                value: chId,
                description: ch ? `#${ch.name}` : 'غير معروف'
            };
        });
        const select = new StringSelectMenuBuilder().setCustomId(`specialchannelsSelect:${section}:remove`).setPlaceholder('اختار قناة للحذف').addOptions(options);
        const row = new ActionRowBuilder().addComponents(select);
        await interaction.reply({ content: '➖ اختار القناة:', components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    // LIST buttons → inline reply
    if (action === 'list') {
        const cfg = getGuildConfig(interaction.guild.id);
        const key = keyForSection(section);
        if (!key) return false;
        const list = Array.isArray(cfg[key]) ? cfg[key] : [];
        if (list.length === 0) {
            await interaction.reply({ content: `ما فيه قنوات لـ ${labelForSection(section)} 3:`, flags: MessageFlags.Ephemeral });
            return true;
        }
        const guild = interaction.guild;
        const lines = list.map((id) => {
            const ch = guild.channels.cache.get(id);
            return ch ? `<#${id}> (${ch.name})` : `<#${id}>`;
        }).join('\n');
        const title = section === 'nomsg' ? '🚫 قنوات منع الرسائل' : '🖼️ قنوات منع الصور';
        const embed = new EmbedBuilder().setColor('#E7D3B0').setTitle(title).setDescription(lines.slice(0, 4000));
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

module.exports = { handle };
