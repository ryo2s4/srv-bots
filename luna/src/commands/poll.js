const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const games = require('../handlers/games');

const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// محلل مدة مصغّر: 30s / 10m / 2h / 1d
function parseDuration(input) {
    if (!input) return null;
    const match = String(input).trim().match(/^(\d+)\s*([smhd])$/i);
    if (!match) return null;
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
    const ms = parseInt(match[1], 10) * mult;
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.min(Math.max(ms, 30 * 1000), 30 * 24 * 60 * 60 * 1000); // بين 30 ثانية و 30 يوم
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('إنشاء تصويت')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('سؤال التصويت')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('options')
                .setDescription('الخيارات مفصولة بفاصلة — من 2 إلى 10 (مثال: خيار 1، خيار 2، خيار 3)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('مدة التصويت قبل الإغلاق التلقائي (مثال: 30s أو 10m أو 2h أو 1d)')
                .setRequired(false)),
    async execute(interaction) {
        const question = interaction.options.getString('question').trim();
        const optionsRaw = interaction.options.getString('options');
        const durationInput = interaction.options.getString('duration');

        const options = optionsRaw.split(/[,،]/).map((opt) => opt.trim()).filter((opt) => opt.length > 0);

        if (options.length < 2) {
            return interaction.reply({ embeds: [UI.error('آسف بس، لازم خيارين على الأقل للتصويت — افصل بين الخيارات بفاصلة (،) 3:')], flags: MessageFlags.Ephemeral });
        }
        if (options.length > 10) {
            return interaction.reply({ embeds: [UI.error('آسف بس، الحد الأقصى 10 خيارات 3:')], flags: MessageFlags.Ephemeral });
        }

        let durationMs = null;
        if (durationInput) {
            durationMs = parseDuration(durationInput);
            if (!durationMs) {
                return interaction.reply({ embeds: [UI.error('آسف بس، صيغة الوقت غير صحيحة… استخدم مثل: `30s` أو `10m` أو `2h` أو `1d` 3:')], flags: MessageFlags.Ephemeral });
            }
        }

        const pollId = Math.random().toString(36).slice(2, 10);
        const optionsText = options.map((opt, i) => `${numberEmojis[i]} ${opt}`).join('\n');

        const embed = UI.embed({
            color: UI.COLORS.events,
            title: `📊 ${question}`,
            description: optionsText,
            footerText: durationMs
                ? `ينتهي تلقائيًا بعد ${UI.fmtDuration(durationMs)} · تصويت بواسطة: ${interaction.user.tag}`
                : `تصويت بواسطة: ${interaction.user.tag}`
        });

        const components = [
            UI.row(UI.btn(`poll:close:${interaction.user.id}:${pollId}`, 'إغلاق الاستطلاع', { emoji: '🔒' }))
        ];

        const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true });

        for (let i = 0; i < options.length; i++) {
            await reply.react(numberEmojis[i]).catch(() => {});
        }

        games.registerPoll({
            client: interaction.client,
            guildId: interaction.guild ? interaction.guild.id : '',
            channelId: interaction.channelId,
            messageId: reply.id,
            ownerId: interaction.user.id,
            ownerTag: interaction.user.tag,
            question,
            choices: options,
            durationMs,
            pollId
        });
    },
};
