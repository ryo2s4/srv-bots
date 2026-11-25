const {
    SlashCommandBuilder,
    ButtonStyle
} = require('discord.js');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('متجر Luna Points 🛍️✨')
        .setDMPermission(false),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const now = Date.now();
        const nextDaily = new Date(now);
        nextDaily.setUTCHours(24, 0, 0, 0);
        const nextDailyTs = Math.floor(nextDaily.getTime() / 1000);

        const d = new Date(now);
        const dow = d.getUTCDay();
        const daysToNextMonday = (8 - dow) % 7 || 7;
        const nextWeeklyTs = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToNextMonday, 0, 0, 0) / 1000);

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '🛍️ متجر لونا — Luna Points ✨',
            description: [
                'اختار القسم من الأزرار بالأسفل 👇',
                '',
                `> ⏳ **اليومي يتجدد:** <t:${nextDailyTs}:R>`,
                `> ⏳ **الأسبوعي يتجدد:** <t:${nextWeeklyTs}:R>`,
                '',
                '🗓️ **عروض يومية** — تتغير كل يوم',
                '📅 **عروض أسبوعية** — تتغير كل أسبوع',
                '⚡ **بوستات** — مزايا مؤقتة مثل زيادة الخبرة',
                '🤝 **خدمات** — خدمات مفيدة مثل نقل XP وVIP',
                '📦 **Bundles** — باقات جاهزة بقيمة أفضل',
                '🏷️ **Limited** — عنصر محدود يتغير يوميًا',
                '⭐ **Featured** — عنصر مميز يتغير يوميًا',
                '🎁 **Mystery Boxes** — صناديق صغيرة/متوسطة/كبيرة',
                '🏆 **مزاد أسطوري** — مزايدة على رتبة أسطورية',
                '',
                '> 🎒 لو عندك عناصر بممتلكاتك تقدر تستخدمها من `/use`',
                '> 🛡️ المتجر محمي ضد الاستغلال (Cooldowns + منع الرصيد السالب)'
            ].join('\n'),
            footerText: `طلبته: ${interaction.user.tag}`
        });

        const row = UI.row(
            UI.btn('shop:daily', 'عروض يومية 🗓️', { style: ButtonStyle.Primary }),
            UI.btn('shop:weekly', 'عروض أسبوعية 📅', { style: ButtonStyle.Primary }),
            UI.btn('shop:utility', 'رتب الصلاحيات 🔧', { style: ButtonStyle.Secondary }),
            UI.btn('shop:more', 'بوستات/خدمات ⚡🤝', { style: ButtonStyle.Secondary })
        );

        const row2 = UI.row(
            UI.btn('shop:auction', 'مزاد 🏆', { style: ButtonStyle.Primary }),
            UI.btn('shop:featured', 'Featured ⭐', { style: ButtonStyle.Secondary }),
            UI.btn('shop:limited', 'Limited 🏷️', { style: ButtonStyle.Secondary }),
            UI.btn('shop:mystery', 'Mystery 🎁', { style: ButtonStyle.Secondary }),
            UI.btn('shop:inventory', 'ممتلكاتي 🎒', { style: ButtonStyle.Secondary })
        );

        await interaction.reply({ embeds: [embed], components: [row, row2] });
    }
};
