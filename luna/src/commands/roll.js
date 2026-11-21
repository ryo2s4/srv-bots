const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

const dieFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('رمي نرد')
        .addStringOption(option =>
            option.setName('dice')
                .setDescription('صيغة النرد (مثال: 2d6، 1d20، 3d8+5)')
                .setRequired(false)),
    async execute(interaction) {
        const diceInput = interaction.options.getString('dice') || '1d6';
        const diceRegex = /^(\d*)d(\d+)([+-]\d+)?$/i;
        const match = diceInput.match(diceRegex);

        if (!match) {
            return interaction.reply({ embeds: [UI.error('آسف بس، صيغة النرد غير صحيحة. استخدمي مثل: `2d6` أو `1d20` أو `3d8+5` 3:')], flags: MessageFlags.Ephemeral });
        }

        const numDice = parseInt(match[1]) || 1;
        const sides = parseInt(match[2]);
        const modifier = parseInt(match[3]) || 0;

        if (numDice > 100 || sides > 1000) {
            return interaction.reply({ embeds: [UI.error('آسف بس، الرقم كبير مرة… الحد الأقصى: 100 نرد و 1000 وجه 3:')], flags: MessageFlags.Ephemeral });
        }

        const rolls = [];
        for (let i = 0; i < numDice; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
        }

        const sum = rolls.reduce((a, b) => a + b, 0);
        const total = sum + modifier;

        // عرض كل نرد بوجهه ⚀⚁⚂⚃⚄⚅ (لما تكون النردات قليلة والوجه 6 أو أقل)
        const useFaces = numDice <= 6 && sides <= 6;
        const resultsText = useFaces
            ? rolls.map((r) => `${dieFaces[r - 1]} ${r}`).join('   ')
            : rolls.join(', ');

        // احتفال/تعزية
        const allMax = rolls.every((r) => r === sides);
        const allOnes = rolls.every((r) => r === 1);
        let note = '';
        if (allMax) note = '\n\n🎉 **رمية مثالية!** كل النرد على أعلى وجه!';
        else if (allOnes) note = '\n\n💀 **كل النرد واحد…** الحظ مو اليوم، جرّب مرة ثانية!';

        const embed = UI.embed({
            color: UI.COLORS.events,
            title: '🎲 رمي نرد',
            description: note ? note.trim() : null,
            fields: [
                { name: '🎲 الصيغة', value: `\`${diceInput.toUpperCase()}\``, inline: true },
                { name: '🎯 النتائج', value: resultsText, inline: false },
                { name: '🧮 المجموع', value: `**${UI.fmtNum(total)}**${modifier ? ` (${UI.fmtNum(sum)}${modifier >= 0 ? '+' : ''}${UI.fmtNum(modifier)})` : ''}`, inline: true }
            ]
        });

        await interaction.reply({ embeds: [embed] });
    },
};
