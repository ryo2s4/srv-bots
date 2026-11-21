const { SlashCommandBuilder, StringSelectMenuBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const UI = require('../utils/ui');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

const SECTIONS = [
    {
        key: 'home',
        title: '📖 دليل أنظمة لونا',
        icon: '📖',
        color: UI.COLORS.docs,
        desc: `هنا تلقى شرح كل نظام بالتفصيل 👇

> 🌟 **التلفيل والنقاط** — الخبرة والمستويات
> 🔮 **الرونات** — تعزيزات وترقية ودمج
> 🛒 **المتجر** — نقاط لونا والمشتريات
> 🎮 **الفعاليات** — ألعاب تفكير بجوائز
> 🎫 **التكتات** — الدعم وإدارة الطلبات
> ⚖️ **سجل العقوبات** — التحذيرات والرتب
> 🛡️ **الإشراف** — الحماية والأتمتة
> 🎵 **الموسيقى** — تشغيل وتحكم بالفويس

اختار القسم من القائمة تحت ✨`
    },
    {
        key: 'leveling',
        title: '🌟 التلفيل والمستويات',
        icon: '🌟',
        color: UI.COLORS.levels,
        desc: `كيف تطلع مستوى؟ 📈
- كل رسالة تمنحك خبرة (مع كولداون 60 ثانية ضد الفارمين).
- كل ما مستوى أعلى، تحتاج خبرة أكثر.
- **التوعيب = نقاط لونا + هدايا + رونات!** 🎁

🔮 الرونات مع التوعيب:
- كل توعيب ياخذ فرصة لونزول رونة — **والفرصة تزيد مع مستواك**.
- 🍀 ضمان الحظ السيء: لو جرّبت 5 توعيبات بدون رونة، الجاية **مضمونة**!
- \`/level\` يوريك فرصة النزول الحالية وعداد الضمان.

🏆 معالم المستوى (Milestones):
- المستوى **10 / 25 / 50 / 100 / 250 / 500** = مكافأة نقاط كبيرة + **رونة مضمونة** من طبقة عالية!
- كل ما تقدمت، طبقة الرونة المضمونة أعلى (نادر ← ملحمي ← أسطوري ← خرافي).

التعزيزات تزيد مكسبك (تتراكم ضربًا):
- ⚡ تعزيزات XP / تعزيزات نقاط من المتجر.
- 🎭 تعزيزات الرتب (حسب إعدادات السيرفر).
- 🔮 الرونات المجهّزة (حتى 3).

الأوامر:
- \`/level\` مستواك · \`/leaderboard\` المتصدرون · \`/profile\` بطاقتك`
    },
    {
        key: 'points',
        title: '🌙 نقاط لونا',
        icon: '🌙',
        color: UI.COLORS.gold,
        desc: `النقاط هي عملة البوت 💰
- تربحها من: الفعاليات، المهمات اليومية، التوعيب، والصناديق.
- تستخدمها في: المتجر، الرونات، المزاد، والهدايا.
- تقدر تحرقها على **ترقية وإعادة تدوير ودمج الرونات** (شوف قسم الرونات 🔮).

نصائح:
- 🎁 \`/daily\` كل يوم — مهمات سهلة بجوائز.
- 🎁 \`/gift\` تهدي نقاط لأصدقائك (ضريبة 8%).
- ⚠️ لا تفرّم — الكولداونات تحمي الاقتصاد.`
    },
    {
        key: 'runes',
        title: '🔮 الرونات',
        icon: '🔮',
        color: UI.COLORS.levels,
        desc: `الرونات تعزيزات دائمة ترفع مكسبك 🔮
- طبقات: ⚪ شائع · 🟢 غير شائع · 🔵 نادر · 🟣 ملحمي · 🟠 أسطوري · 🔴 خرافي.
- بعضها **ثنائي** (تعزيزين برونة وحدة) وكل ما طبقة أعلى = تعزيز أقوى.
- ⭐ النجوم ترفع قيمة الرونة وتعزيزاتها.

كل شي بالرونات من \`/runes\`:
- ⚡ **تجهيز** حتى 3 رونات — تعزيزاتها تتراكم ضربًا.
- ⬆️ **ترقية** — +⭐ نجمة وتعزيزات أقوى (+5% إلى +15% لكل تعزيز).
- 🔁 **إعادة تدوير** — تغيّر التعزيزات بالكامل (نفس الطبقة والنجوم).
- 🧬 **دمج** — 3 رونات بنفس الطبقة ← **رونة من الطبقة الأعلى**!
  و3 رونات خرافية (أعلى طبقة) ← ترقية نجمة + تقوية.
- 💸 **بيع وشراء** رونات بنقاط لونا.

طرق الحصول عليها:
- 🎁 نزول مع التوعيب (فرصتها تزيد مع مستواك + ضمان الحظ السيء).
- 🏆 رونة مضمونة معالم المستوى (10/25/50/100/250/500).
- 🧬 الدمج · 🛒 الشراء من \`/runes\`.`
    },
    {
        key: 'events',
        title: '🎮 الفعاليات والألعاب',
        icon: '🎮',
        color: UI.COLORS.events,
        desc: `نظام الفعاليات يرسل ألعاب تفكير بشكل دوري في روم محدد 🧠
- **أول شخص يحلها صح يفوز وتفتح الفعالية فورًا.**
- الجواب الغلط = خروج من الفعالية بدون إعادة محاولات.
- اللي عليه كولداون فوز ما يقدر يشارك لين ينتهي الكولداون.
- كل الألعاب تحتاج تفكير وفهم: حساب متسلسل، الجبر، التسلسلات، المنطق، الصادق والكاذب، الشفرة، التناظر اللفظي، الاتجاهات، المصفوفات، الألغاز، وألعاب ضد البوت (اكس-او ونيم).
- المكافأة Luna Points ضمن رينج محدد (وتزيد حسب البوستات والرونات).
- يوجد سجل للفعاليات (History) داخل لوحة الأحداث.`
    },
    {
        key: 'shop',
        title: '🛒 المتجر والإنفنتوري',
        icon: '🛒',
        color: UI.COLORS.shop,
        desc: `المتجر يعتمد على نقاط لونا 🛍️
- \`/shop\` المتجر — فيه قسم يومي وأسبوعي + مميز + محدود + مزاد.
- \`/inventory\` أغراضك · \`/use\` استخدامها.
- \`/topshop\` ترتيب "قوة المتجر".

المنتجات:
- 🎁 صناديق غامضة (نقاط/تعزيزات/مقتنيات).
- ⚡ بطاقات تعزيز (XP / نقاط / مكافآت التوعيب).
- 🧾 خدمات (تغيير اسم، نقل خبرة، درع، إعادة توازن).
- 🎭 عناوين ورتب (من كتالوج الإدارة).

كل يوم/أسبوع يتغير العرض + خصم أول شراء باليوم!`
    },
    {
        key: 'tickets',
        title: '🎫 التكتات',
        icon: '🎫',
        color: UI.COLORS.tickets,
        desc: `نظام التكتات للدعم والطلبات 🎫
- تفتح تكت من لوحة التكتات حسب النوع.
- أزرار للإدارة: استلام / إغلاق / أرشفة / حذف.
- مؤقتات للتنبيه عند عدم الرد + إغلاق تلقائي عند عدم النشاط.
- الأرشفة ترسل ملف HTML كامل بمحادثة التكت.`
    },
    {
        key: 'punishlog',
        title: '⚖️ سجل العقوبات',
        icon: '⚖️',
        color: UI.COLORS.mod,
        desc: `نظام سجل العقوبات (Punish Log) ⚖️
- يسوي سجل لكل عضو داخل Forum Thread خاص فيه.
- يسجل نوع العقوبة + السبب + المدة + وقت التنفيذ.
- يعطي رتب تحذير حسب عدد العقوبات (تقدر تكون مؤقتة).
- عند انتهاء مدة رتبة التحذير، البوت يشيلها تلقائيًا ويرسل إشعار.
- فيه باند تلقائي بعد حد معين من التحذيرات.

الأوامر:
- \`/punishlog config\` (Administrator)
- \`/punishlog add\` / \`/punishlog history\` (ModerateMembers)`
    },
    {
        key: 'moderation',
        title: '🛡️ التحذيرات والإشراف',
        icon: '🛡️',
        color: UI.COLORS.mod,
        desc: `أنظمة الإدارة والإشراف 🛡️
- التحذيرات: \`/warn\` · \`/warnings\` · \`/warnings_clear\`.
- العقوبات: \`/ban\` · \`/kick\` · \`/timeout\` · \`/clear\`.
- AutoMod: مكافحة السبام/الروابط/السب والقذف (\`/automod\`).
- AI Mod: إشراف ذكي يفهم العربي (\`/aimod\`).
- الحماية: نظام Anti-Raid والتحقق (\`/security\`).`
    },
    {
        key: 'adminreport',
        title: '📋 تقارير الإدارة',
        icon: '📋',
        color: UI.COLORS.info,
        desc: `نظام تقارير الإدارة (Admin Report) 📋
- يقدم الأدمن/المود تقرير يومي عن شغله.
- يُحتسب النقاط: تكتات + تايمات + باند + تحسينات.
- التقارير تُنشر بروم التقارير (كل أدمن بثريد خاص).

الصلاحيات:
- الكونفغ = Administrator
- القوائم (الغائبين/اليوم/المتصدرين) = ModerateMembers`
    },
    {
        key: 'forum',
        title: '📰 منشورات الفورم',
        icon: '📰',
        color: UI.COLORS.tickets,
        desc: `أمر \`/forum\` يفتح UI تبني فيه منشور محترم 📰
- تسوي Embed بعنوان/وصف/لون/صورة.
- تضيف أزرار (حتى 5) ولكل زر قائمة خيارات (Select Menu).
- كل خيار تكتب له رد خاص (label => response).
- تقدر تنشر بروم عادي أو فورم (ويصير ثريد).

الصلاحية: Manage Messages`
    },
    {
        key: 'logs',
        title: '🧾 اللوغز (Logs)',
        icon: '🧾',
        color: UI.COLORS.logs,
        desc: `نظام اللوغز يسجل أحداث مهمة بالسيرفر 🧾
- حذف/تعديل رسائل (مع المرفقات).
- تغييرات الرتب والرومات والصلاحيات.
- دخول/خروج الأعضاء، الباندات، والدعوات.
- تقدر تختار الأقسام المفعّلة وتستثني رومات معينة.`
    },
    {
        key: 'extras',
        title: '✨ إضافات ثانية',
        icon: '✨',
        color: UI.COLORS.primary,
        desc: `ميزات إضافية ✨
- 🌈 RGB Role (رتبة تتغير ألوانها باستمرار).
- 🤖 AI panel — شات ذكاء اصطناعي بروم محدد.
- 📦 Lootboxes — صناديق نقاط تلقائية بالرومات.
- 💬 ردود/تفاعلات تلقائية + **اختصارات نصية لكل الأوامر** (\`/shortcuts\` — تكتب كلمة والبوت ينفذ الأمر).
- 🎵 الموسيقى — تشغيل ملفات صوتية بالفويس مع تحكم كامل:
  ⏮️⏭️ تقديم/تأخير 15 ثانية · 📥 قائمة انتظار (خلط/مسح) · 🔁 تكرار (مقطع/كل القائمة) · 🔊 صوت · 🚪 خروج تلقائي لو تبقى البوت لحالها.
- 💾 نسخ احتياطي للإعدادات (\`/backup\`).`
    }
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);

function getSection(key) {
    return SECTIONS.find((s) => s.key === key) || SECTIONS[0];
}

function buildMechanicsEmbed(sectionKey, requesterTag) {
    const s = getSection(sectionKey);
    return UI.embed({
        title: s.title,
        description: s.desc,
        color: s.color,
        footerText: requesterTag ? `طلبته: ${requesterTag}` : 'دليل لونا'
    });
}

function buildMechanicsRows(ownerId = '') {
    const rows = [];
    rows.push(UI.row(
        new StringSelectMenuBuilder()
            .setCustomId(`mechanicsSelect:${ownerId}`)
            .setPlaceholder('📖 اختار القسم اللي تبغى تعرف عنه...')
            .addOptions(SECTIONS.filter((s) => s.key !== 'home').map((s) => ({
                label: s.title,
                value: s.key,
                description: s.desc.split('\n')[0].slice(0, 80)
            })))
    ));
    rows.push(UI.row(
        UI.btn('mechanics:home', '🏠 الرئيسية', { style: ButtonStyle.Secondary }),
        UI.btn(`help:home:${ownerId}`, '📚 أوامر البوت', { style: ButtonStyle.Secondary })
    ));
    return rows;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mechanics')
        .setDescription('شرح ميكانيكس البوت')
        .setDMPermission(false)
        .addChannelOption((o) =>
            o
                .setName('channel')
                .setDescription('روم ثابت ينشر فيه الدليل ويبقى للجميع (للمشرفين)')
                .setRequired(false)
        ),

    buildMechanicsEmbed,
    buildMechanicsRows,

    // أزرار قديمة + زر الرئيسية
    async handleMechanicsButton(interaction) {
        const parts = String(interaction.customId || '').split(':');
        const key = parts[1] || 'home';
        const embed = buildMechanicsEmbed(key, interaction.user ? interaction.user.tag : null);
        // Public guide: no per-user lock, so anyone can browse it.
        const components = buildMechanicsRows('');

        try {
            return await interaction.update({ embeds: [embed], components });
        } catch {
            try {
                return await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
            } catch {
                return;
            }
        }
    },

    async handleMechanicsSelect(interaction) {
        const key = Array.isArray(interaction.values) && interaction.values[0] ? String(interaction.values[0]) : 'home';

        // Public guide: anyone may browse it.
        const embed = buildMechanicsEmbed(key, interaction.user ? interaction.user.tag : null);
        const components = buildMechanicsRows('');
        try {
            return await interaction.update({ embeds: [embed], components });
        } catch {
            try {
                return await interaction.reply({ embeds: [embed], components });
            } catch {
                return;
            }
        }
    },

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هذا الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        const embed = buildMechanicsEmbed('home', interaction.user.tag);
        const components = buildMechanicsRows('');

        const requested = interaction.options.getChannel('channel');
        const cfg = getGuildConfig(interaction.guild.id);

        // Admins can pin the panel to a dedicated channel.
        if (requested) {
            const canManage = interaction.memberPermissions
                ? interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
                : false;
            if (!canManage) {
                return interaction.reply({ content: 'تحتاج صلاحية Manage Server عشان تحدد روم للدليل 3:', flags: MessageFlags.Ephemeral });
            }
            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, mechanicsChannelId: requested.id }));
            try {
                await requested.send({ embeds: [embed], components });
            } catch {
                return interaction.reply({ content: 'ما قدرت أرسل في هذا الروم — تأكد من صلاحياتي 3:', flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({ content: `✅ تم نشر الدليل في <#${requested.id}>`, flags: MessageFlags.Ephemeral });
        }

        // Default: post publicly so everyone can see and interact with it.
        const pinnedId = typeof cfg.mechanicsChannelId === 'string' ? cfg.mechanicsChannelId : null;
        const target = pinnedId ? interaction.guild.channels.cache.get(pinnedId) : null;
        if (target && typeof target.send === 'function') {
            try {
                await target.send({ embeds: [embed], components });
                return interaction.reply({ content: `✅ تم إرسال الدليل إلى <#${pinnedId}>`, flags: MessageFlags.Ephemeral });
            } catch {
                // fall through to replying in place
            }
        }

        return interaction.reply({ embeds: [embed], components });
    }
};
