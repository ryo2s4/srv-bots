const { SlashCommandBuilder } = require('discord.js');
const UI = require('../utils/ui');

// إحصائيات جلسة كل لاعب (تبقى طول ما البوت شغّال)
const stats = new Map(); // userId → { flips, heads, tails, currentRun, runSide }

function getStats(userId) {
    if (!stats.has(userId)) {
        stats.set(userId, { flips: 0, heads: 0, tails: 0, currentRun: 0, runSide: null });
    }
    return stats.get(userId);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('رمي عملة')
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('عدد الرميات (1-5)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)),
    async execute(interaction) {
        const count = interaction.options.getInteger('count') || 1;
        const s = getStats(interaction.user.id);

        const results = [];
        for (let i = 0; i < count; i++) {
            const side = Math.random() < 0.5 ? 'وجه' : 'كتابة';
            results.push(side);
            s.flips++;
            if (side === 'وجه') s.heads++;
            else s.tails++;
            if (s.runSide === side) s.currentRun++;
            else {
                s.runSide = side;
                s.currentRun = 1;
            }
        }

        const resultsLine = results.map((r) => `🪙 **${r}**`).join(' · ');
        const statsLine = `📊 رمياتك: **${UI.fmtNum(s.flips)}** (وجه ${UI.fmtNum(s.heads)} · كتابة ${UI.fmtNum(s.tails)}) · سلسلة حالية: **${s.currentRun}× ${s.runSide}**`;

        const embed = UI.embed({
            color: UI.COLORS.events,
            title: count > 1 ? `🪙 رمي عملة ×${count}` : '🪙 رمي عملة',
            description: `${resultsLine}\n\n${statsLine}`
        });

        await interaction.reply({ embeds: [embed] });
    },
};
