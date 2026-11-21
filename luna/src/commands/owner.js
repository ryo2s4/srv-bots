const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    MessageFlags
} = require('discord.js');

const { getMonitors } = require('../monitorStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('owner')
        .setDescription('لوحة تحكم المالك - للأغراض الإدارية والصيانة')
        .setDMPermission(true),

    async execute(interaction) {
        const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
        const isOwner = !!ownerId && String(interaction.user.id) === String(ownerId);

        const monitorCount = getMonitors().length;

        const embed = new EmbedBuilder()
            .setColor(0x2c2c54)
            .setTitle('🔐 لوحة تحكم المالك')
            .setDescription('مرحباً بك في لوحة التحكم. يرجى اختيار الإجراء المطلوب من القائمة أدناه.')
            .addFields(
                { name: '📊 الإحصائيات العامة', value: 'عرض معلومات شاملة عن البوت', inline: true },
                { name: '🏰 إدارة السيرفرات', value: 'عرض قائمة السيرفرات والخروج منها', inline: true },
                { name: '👑 منح رتبة', value: 'منح رتبة لمستخدم في سيرفر معين', inline: true },
                { name: '🔍 مراقبة الرسائل', value: `مراقبة روم وارساله لروم آخر (${monitorCount} نشط)`, inline: true },
                { name: '🗑️ سحب رتبة', value: 'سحب رتبة من مستخدم في سيرفر معين', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'نظام الإدارة المتقدم' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('owner:botinfo')
                .setLabel('معلومات البوت')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📊')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:guilds')
                .setLabel('إدارة السيرفرات')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🏰')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:grantrole')
                .setLabel('منح رتبة')
                .setStyle(ButtonStyle.Success)
                .setEmoji('👑')
                .setDisabled(!isOwner)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('owner:eval')
                .setLabel('تنفيذ كود')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('⚡')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:refresh')
                .setLabel('تحديث البيانات')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔄')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:monitor')
                .setLabel('مراقبة الرسائل')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔍')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:removerole')
                .setLabel('سحب رتبة')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
                .setDisabled(!isOwner)
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('owner:presence')
                .setLabel('تغيير الحالة')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🟢')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:setowner')
                .setLabel('تعيين/حذف المالك')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('👤')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:exportcsv')
                .setLabel('تصدير CSV')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📥')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:broadcast')
                .setLabel('بث رسالة')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📣')
                .setDisabled(!isOwner),
            new ButtonBuilder()
                .setCustomId('owner:restart')
                .setLabel('إعادة تشغيل')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔁')
                .setDisabled(!isOwner)
        );

        return interaction.reply({
            embeds: [embed],
            components: [row1, row2, row3]
        });
    },

    buildMonitorPanelEmbed(monitors) {
        const count = Array.isArray(monitors) ? monitors.length : 0;

        const embed = new EmbedBuilder()
            .setColor(0x2c2c54)
            .setTitle('🔍 مراقبة الرسائل')
            .setDescription('إدارة مراقبة الرسائل عبر السيرفرات. الرسائل ترسل مع اسم الكاتب، الصورة الشخصية، والمرفقات.')
            .setTimestamp();

        if (count === 0) {
            embed.addFields({
                name: '📭 لا توجد مراقبات',
                value: 'لا يوجد أي مراقبة حالياً. اضغط على **➕ إضافة مراقبة** لبدء مراقبة روم معين.'
            });
            embed.setColor(0x808080);
        } else {
            let listStr = '';
            monitors.forEach((m, i) => {
                const sourceLink = `<#${m.sourceChannelId}>`;
                const targetLink = `<#${m.targetChannelId}>`;
                listStr += `**${i + 1}.** ${sourceLink} ← ${targetLink}\n`;
            });
            embed.addFields({ name: `📋 قائمة المراقبات (${count})`, value: listStr.slice(0, 1024) });
        }

        embed.setFooter({ text: 'اختر مراقبة من القائمة لحذفها' });
        return embed;
    }
};
