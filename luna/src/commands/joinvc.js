const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('joinvc')
        .setDescription('خلي لونا تدخل قناة الفويس اللي انت فيها')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Connect),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const voice = interaction.member && interaction.member.voice ? interaction.member.voice : null;
        const channel = voice && voice.channel ? voice.channel : null;
        if (!channel) {
            return interaction.reply({ content: 'ادخل فويس أول وبعدين استعمل الأمر 3:', ephemeral: true });
        }

        let joinVoiceChannel;
        try {
            ({ joinVoiceChannel } = require('@discordjs/voice'));
        } catch {
            return interaction.reply({ content: 'نقص حزمة الفويس. ثبتها: `npm i @discordjs/voice` ثم أعد تشغيل البوت.', ephemeral: true });
        }

        try {
            joinVoiceChannel({
                channelId: channel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: true
            });
        } catch {
            return interaction.reply({ content: 'آسف ما قدرت أدخل الفويس… تأكد أن عندي صلاحية Connect 3:', ephemeral: true });
        }

        return interaction.reply({ content: `✅ دخلت فويس: **${channel.name}**`, ephemeral: true });
    }
};
