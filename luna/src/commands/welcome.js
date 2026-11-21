const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');
const { updateGuildConfig } = require('../guildConfig');
const { buildWelcomePanel } = require('../handlers/welcome');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('لوحة الترحيب والوداع — رسائل وصور (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addAttachmentOption((o) =>
            o
                .setName('image')
                .setDescription('ارفع صورة ترحيب مباشرة (اختياري)')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', flags: MessageFlags.Ephemeral });
        }

        // Dropping an image on the command sets the welcome picture instantly.
        const attachment = interaction.options.getAttachment('image');
        if (attachment) {
            if (!attachment.contentType || !String(attachment.contentType).startsWith('image/')) {
                return interaction.reply({ content: 'المرفق هذا مو صورة 3:', flags: MessageFlags.Ephemeral });
            }
            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                welcome: { ...(c.welcome || {}), imageUrl: attachment.url }
            }));
            return interaction.reply({
                content: `✅ تم حفظ صورة الترحيب (${attachment.name || 'image'}).\n\nاستخدم \`/welcome\` بدون مرفقات لفتح لوحة التحكم.`,
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            ...buildWelcomePanel(interaction.guild.id, interaction.guild),
            flags: MessageFlags.Ephemeral
        });
    }
};
