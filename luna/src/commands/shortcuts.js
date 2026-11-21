const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildConfig } = require('../guildConfig');
const { listShortcutCommands } = require('../utils/shortcutRunner');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shortcuts')
        .setDescription('إدارة اختصارات الأوامر النصية')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', flags: MessageFlags.Ephemeral });
        }

        const cfg = getGuildConfig(interaction.guild.id);
        const shortcuts = Array.isArray(cfg.shortcuts) ? cfg.shortcuts : [];
        const count = shortcuts.length;

        const statusEmoji = count > 0 ? '🟢' : '🔴';
        
        const availableCommands = listShortcutCommands(interaction.client);
        const commandList = availableCommands.map((c) => `\`${c.name}\``).join(' ') || '—';

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('⚡ اختصارات الأوامر')
            .setDescription(
                `**الحالة:** ${statusEmoji} ${count > 0 ? `${count} اختصار نشط` : 'لا توجد اختصارات'}\n\n` +
                '💡 **الفكرة:** تكتب كلمة أو إيموجي والبوت ينفذ الأمر تلقائياً!\n\n' +
                '** أمثلة:**\n' +
                '• `تايم @user 10m` ← ينفذ `/timeout`\n' +
                '• `🚫 @user` ← يطرد العضو\n' +
                '• `!متجري` ← يعرض المتجر'
            )
            .addFields(
                { 
                    name: `⚙️ الأوامر المتاحة للاختصار (${availableCommands.length})`, 
                    value: commandList.slice(0, 1024), 
                    inline: false 
                }
            )
            .setFooter({ text: '⚡ صلاحية Manage Server مطلوبة' })
            .setTimestamp();

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('shortcuts:add')
                .setLabel('إضافة اختصار')
                .setStyle(ButtonStyle.Success)
                .setEmoji('➕'),
            new ButtonBuilder()
                .setCustomId('shortcuts:edit')
                .setLabel('تعديل')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️')
                .setDisabled(count === 0),
            new ButtonBuilder()
                .setCustomId('shortcuts:remove')
                .setLabel('حذف')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
                .setDisabled(count === 0)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('shortcuts:list')
                .setLabel('عرض الاختصارات')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📋')
                .setDisabled(count === 0),
            new ButtonBuilder()
                .setCustomId('shortcuts:clear')
                .setLabel('حذف الكل')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('⚠️')
                .setDisabled(count === 0)
        );

        return interaction.reply({ embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral });
    }
};
