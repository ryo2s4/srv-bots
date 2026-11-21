const {
  EmbedBuilder,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../config');

function isOwner(userId) {
  return userId === config.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder().setName('owner').setDescription('لوحة تحكم المالك (للمالك فقط)'),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: '❌ هذا الأمر مخصص للمالك فقط.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(config.EMBED_COLOR)
      .setTitle('⚙️ لوحة تحكم المالك')
      .setDescription('اختر أحد الأزرار أدناه:')
      .addFields([
        { name: '🔨 Ban', value: 'حظر عضو في سيرفر محدد', inline: true },
        { name: '🔓 Unban', value: 'إلغاء حظر عضو في سيرفر محدد', inline: true },
        { name: '🖥️ Servers', value: 'عرض السيرفرات التي فيها البوت', inline: true },
      ]);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('owner_ban').setLabel('Ban').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('owner_unban').setLabel('Unban').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner_servers').setLabel('Servers').setStyle(ButtonStyle.Primary),
    );

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },

  async handleButton(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: '❌ هذا الزر مخصص للمالك فقط.', ephemeral: true });
    }

    if (interaction.customId === 'owner_ban') {
      const modal = new ModalBuilder().setCustomId('modal_ban').setTitle('Ban Member');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('server_id').setLabel('Server ID').setStyle(TextInputStyle.Short).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Short).setRequired(false),
        ),
      );
      return interaction.showModal(modal);
    }

    if (interaction.customId === 'owner_unban') {
      const modal = new ModalBuilder().setCustomId('modal_unban').setTitle('Unban Member');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('server_id').setLabel('Server ID').setStyle(TextInputStyle.Short).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true),
        ),
      );
      return interaction.showModal(modal);
    }

    if (interaction.customId === 'owner_servers') {
      const guilds = interaction.client.guilds.cache;
      const serverList = guilds.map((g) => `🆔 ${g.id} | ${g.name} (${g.memberCount} members)`).join('\n') || 'لا توجد سيرفرات.';
      const embed = new EmbedBuilder()
        .setColor(config.EMBED_COLOR)
        .setTitle('🖥️ Bot Servers')
        .setDescription(serverList)
        .setFooter({ text: `المجموع: ${guilds.size} سيرفر` });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    return;
  },

  async handleModal(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: '❌ هذا مخصص للمالك فقط.', ephemeral: true });
    }

    if (interaction.customId === 'modal_ban') {
      const serverId = interaction.fields.getTextInputValue('server_id');
      const userId = interaction.fields.getTextInputValue('user_id');
      const reason = interaction.fields.getTextInputValue('reason') || 'No reason provided';

      await interaction.deferReply({ ephemeral: true });
      try {
        const guild = await interaction.client.guilds.fetch(serverId);
        await guild.members.ban(userId, { reason });
        return interaction.editReply(`✅ Banned \`${userId}\` from \`${guild.name}\`.\nReason: ${reason}`);
      } catch (error) {
        return interaction.editReply(`❌ Failed to ban: ${error.message}`);
      }
    }

    if (interaction.customId === 'modal_unban') {
      const serverId = interaction.fields.getTextInputValue('server_id');
      const userId = interaction.fields.getTextInputValue('user_id');

      await interaction.deferReply({ ephemeral: true });
      try {
        const guild = await interaction.client.guilds.fetch(serverId);
        await guild.members.unban(userId);
        return interaction.editReply(`✅ Unbanned \`${userId}\` from \`${guild.name}\`.`);
      } catch (error) {
        return interaction.editReply(`❌ Failed to unban: ${error.message}`);
      }
    }

    return;
  },
};
