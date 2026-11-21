const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');

/**
 * Handle owner:monitoradd button – show modal to add a message monitor
 */
async function handleMonitorAdd({ interaction }) {
    if (!interaction.isButton()) return false;
    if (interaction.customId !== 'owner:monitoradd') return false;

    const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
    if (String(interaction.user.id) !== String(ownerId)) {
        try {
            await interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
        } catch {}
        return true;
    }

    const modal = new ModalBuilder()
        .setCustomId('owner:monitor:modal')
        .setTitle('➕ إضافة مراقبة رسائل');

    const sourceChannelInput = new TextInputBuilder()
        .setCustomId('sourceChannelId')
        .setLabel('🔹 آيدي قناة المصدر')
        .setPlaceholder('ضع آيدي القناة اللي تبغى تراقبها (رقم)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const targetChannelInput = new TextInputBuilder()
        .setCustomId('targetChannelId')
        .setLabel('🔹 آيدي قناة الهدف')
        .setPlaceholder('ضع آيدي القناة اللي تبغى ترسل لها الرسائل المراقَبة')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const sourceGuildInput = new TextInputBuilder()
        .setCustomId('sourceGuildId')
        .setLabel('🔹 آيدي سيرفر المصدر (اختياري)')
        .setPlaceholder('إذا كانت القناة المصدر بسيرفر ثاني، اكتب آيدي السيرفر')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

    const row1 = new ActionRowBuilder().addComponents(sourceChannelInput);
    const row2 = new ActionRowBuilder().addComponents(targetChannelInput);
    const row3 = new ActionRowBuilder().addComponents(sourceGuildInput);

    modal.addComponents(row1, row2, row3);

    try {
        await interaction.showModal(modal);
        return true;
    } catch {
        return false;
    }
}

/**
 * Main handle function – called by routeInteraction for every interaction.
 * Returns true if handled (stops routing chain), false otherwise.
 */
async function handle({ client, interaction }) {
    if (!interaction || !interaction.isButton || !interaction.isButton()) return false;

    if (await handleMonitorAdd({ interaction })) return true;

    return false;
}

module.exports = { handle };
