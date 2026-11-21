const { SlashCommandBuilder } = require('discord.js');
const { getUserStats } = require('../levelsStore');
const { getUserInventory } = require('../shopStore');
const { getBoostNameAr } = require('../boostMeta');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('عرض ممتلكاتك في متجر لونا 🎒')
        .addUserOption(opt =>
            opt.setName('target')
                .setDescription('عرض ممتلكات شخص آخر')
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const target = interaction.options.getUser('target') || interaction.user;
        const stats = getUserStats(interaction.guild.id, target.id);
        const inv = getUserInventory(interaction.guild.id, target.id);

        const displayName = inv.activeTitle ? inv.activeTitle : target.username;

        const titles = inv.titles.length ? inv.titles.map(t => `- ${t.title}`).slice(0, 15).join('\n') : 'لا يوجد';
        const ownedBoosts = inv.boosts.length ? inv.boosts.map(b => `- ${getBoostNameAr(b.type)}`).slice(0, 15).join('\n') : 'لا يوجد';
        const now = Date.now();
        const active = Array.isArray(inv.activeBoosts)
            ? inv.activeBoosts.filter(b => b && (!b.expiresAt || b.expiresAt > now))
            : [];
        const activeBoosts = active.length
            ? active.map(b => `- ${getBoostNameAr(b.type)} — ⏳ ${b.expiresAt ? `متبقي ${UI.fmtDuration(b.expiresAt - now)}` : 'دائم'}`).slice(0, 15).join('\n')
            : 'لا يوجد';
        const roles = inv.roles.length ? inv.roles.map(r => `- <@&${r.roleId}>`).slice(0, 15).join('\n') : 'لا يوجد';
        const renameCards = inv.services && typeof inv.services.renameOnce === 'number' ? inv.services.renameOnce : 0;

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: `🎒 ممتلكات ${displayName}`,
            description: [
                `> 🌙 **نقاط لونا:** ${UI.fmtNum(stats.lunaPoints || 0)}`,
                '',
                'كل شي تملكه مجمّع هنا 💜'
            ].join('\n'),
            fields: [
                { name: 'اللقب النشط 🎭', value: inv.activeTitle ? `**${inv.activeTitle}**` : 'لا يوجد', inline: false },
                { name: '📚 الألقاب', value: titles, inline: false },
                { name: '⚡ بوستات (بطاقات غير مفعلة)', value: ownedBoosts, inline: false },
                { name: '⏳ بوستات نشطة', value: activeBoosts, inline: false },
                { name: '🎨 رتب شكلية', value: roles, inline: false },
                { name: '🤝 خدمات', value: renameCards > 0 ? `- 🎫 بطاقة تغيير الاسم (مرة واحدة): **${UI.fmtNum(renameCards)}**` : 'لا يوجد', inline: false }
            ],
            footerText: target.id === interaction.user.id ? 'ممتلكاتك' : `ممتلكات ${target.username}`
        });

        await interaction.reply({
            embeds: [embed],
            components: [UI.row(
                UI.btn(`shophistory:${interaction.user.id}:${target.id}`, 'سجل المشتريات', { emoji: '🧾' })
            )],
            ephemeral: true
        });
    }
};
