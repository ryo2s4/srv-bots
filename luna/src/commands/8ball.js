const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

// ~8 إجابات إيجابية + ~8 سلبية + ~8 غامضة
const responses = [
    // إيجابية
    'نعم وبقوة.',
    'بدون شك.',
    'نعم بالتأكيد.',
    'تقدر تعتمد عليه.',
    'حسب ما أشوف… نعم.',
    'غالبًا.',
    'المؤشرات جيدة.',
    'العلامات تقول نعم.',
    // سلبية
    'لا تعتمد عليه.',
    'إجابتي: لا.',
    'مصادري تقول لا.',
    'المؤشرات مو جيدة.',
    'أشك كثير.',
    'الفرص ضعيفة حاليًا.',
    'أقول لك بصراحة… لا.',
    'ما أشوف إن هذا بيصير قريب.',
    // غامضة
    'الجواب غير واضح… جرّب مرة ثانية.',
    'اسأل لاحقًا.',
    'الأفضل ما أقول لك الآن.',
    'ما أقدر أتوقع الآن.',
    'ركّز واسأل مرة ثانية.',
    'الكورة تقول: اسألني بعدين 🔮',
    'الغيوب مو بيدي… لكن قلبك يعرف الجواب.',
    'الاحتمالات متساوية الآن.'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('8ball')
        .setDescription('اسأل كرة الحظ (8ball)')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('سؤالك')
                .setRequired(true)),
    async execute(interaction) {
        const question = interaction.options.getString('question');
        const response = responses[Math.floor(Math.random() * responses.length)];

        // السؤال على شكل اقتباس (يسند الأسطر المتعددة)
        const quoted = `> ${question.replace(/\n/g, '\n> ')}`;

        const embed = UI.embed({
            color: UI.COLORS.events,
            title: '🎱 كرة الحظ',
            description: `${quoted}\n\n🔮 **${response}**`,
            footerText: `سأل: ${interaction.user.tag}`
        });

        await interaction.reply({ embeds: [embed] });
    },
};
