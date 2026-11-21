const { SlashCommandBuilder, StringSelectMenuBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const UI = require('../utils/ui');

// أوصاف عربية مختصرة لكل أمر
const AR_DESC = {
    shop: 'المتجر — اشترِ بنقاط لونا',
    shopadminui: 'لوحة إدارة المتجر (إضافة/حذف منتجات، مزاد، كوبونات)',
    inventory: 'عرض أغراضك ومشترياتك',
    use: 'استخدام أغراضك (عناوين، تعزيزات، خدمات)',
    gift: 'إهداء نقاط لونا لعضو (8% ضريبة)',
    topshop: 'ترتيب "قوة المتجر"',
    daily: 'مهماتك اليومية ومكافآتها',
    dailyconfig: 'إعدادات المهمات اليومية (إدارة)',
    lootboxes: 'صناديق نقاط تلقائية برومات',
    boosts: 'عرض تعزيزاتك النشطة',
    runes: 'روناتك — تجهيز وترقية وإعادة تدوير ودمج',
    grantpoints: 'إعطاء نقاط لونا (إدارة)',

    level: 'مستواك — ترتيبك وتعزيزاتك والوجهة القادمة',
    leaderboard: 'لوحة المتصدرين',
    profile: 'بطاقتك الشخصية',
    grantxp: 'إعطاء خبرة (إدارة)',
    togglelevels: 'تشغيل/إيقاف نظام الخبرة (إدارة)',
    levelrewards: 'إعداد مكافآت المستويات (إدارة)',

    '8ball': 'اسأل سؤالاً وجيب إجابة',
    roll: 'رمي نرد',
    coinflip: 'قلب عملة',
    poll: 'استطلاع رأي بأزرار',
    events: 'لوحة إعداد الفعاليات والألعاب (إدارة)',
    mechanics: 'شرح تفصيلي لأنظمة البوت',

    play: 'تصفح وتشغيل الملفات الصوتية',
    music: 'لوحة الموسيقى — تشغيل وتحكم (تقديم/تأخير، قائمة، تكرار، صوت)',
    queue: 'قائمة انتظار الموسيقى',
    skip: 'تخطي الأغنية الحالية',
    nowplaying: 'الأغنية الشغالة الآن',
    joinvc: 'انضمام البوت لروم الفويس',

    tickets: 'نظام التكتات ودعم الأعضاء',
    forum: 'بناء ونشر منشور فورم بأزرار',
    renameforum: 'روم طلبات تغيير الأسماء (معطّل)',
    suggestions: 'نظام الاقتراحات',
    whispers: 'نظام الوسائط المخفية',
    welcome: 'إعداد رسالة ترحيب للأعضاء الجدد (إدارة)',
    replies: 'الردود السريعة المحفوظة',
    autoreply: 'ردود تلقائية على كلمات محددة',
    autoreact: 'ردود فعل تلقائية على الرسائل',
    shortcuts: 'اختصارات نصية تنفّذ أي أمر (كل الأوامر متاحة)',
    specialchannels: 'رومات خاصة (وسائط/رسائل)',

    ban: 'حظر عضو من السيرفر',
    kick: 'طرد عضو من السيرفر',
    timeout: 'إعطاء عضو تايم آوت',
    warn: 'تحذير عضو',
    warnings: 'عرض تحذيرات عضو',
    warnings_clear: 'مسح تحذيرات عضو',
    clear: 'مسح رسائل من الروم',
    punishlog: 'سجل العقوبات ورتب التحذير',
    aimod: 'الإشراف الذكي بالذكاء الاصطناعي (إدارة)',
    automod: 'مكافحة السبام والروابط (إدارة)',
    security: 'لوحة الحماية ضد الاختراقات (إدارة)',
    adminreport: 'تقارير نشاط الإدارة اليومية',
    adminui: 'لوحة أدوات الإدارة (نسخ احتياطي، RGB، تعزيزات)',
    logs: 'إعدادات سجل الأحداث (إدارة)',
    backup: 'نسخ احتياطي واستعادة الإعدادات',
    ai: 'لوحة تحكم شات الذكاء الاصطناعي',

    reactionrole: 'رتب عبر التفاعلات',

    ping: 'سرعة استجابة البوت',
    user: 'معلومات عن عضو',
    avatar: 'صورة العضو',
    serverinfo: 'معلومات السيرفر',
    setupcheck: 'فحص إعدادات البوت',
    help: 'عرض كل الأوامر',
    owner: 'أوامر مالك البوت (خاص)'
};

const CATEGORY_ORDER = ['shop', 'progress', 'fun', 'music', 'tickets', 'admin', 'roles', 'info', 'other'];

const CATEGORY_META = {
    shop: { title: '🛒 المتجر والاقتصاد', color: UI.COLORS.shop, desc: 'كل شي يخص نقاط لونا والمتجر.' },
    progress: { title: '🌙 التقدم والمستويات', color: UI.COLORS.levels, desc: 'خبرتك، مستواك، وترتيبك.' },
    fun: { title: '🎮 الترفيه والفعاليات', color: UI.COLORS.events, desc: 'ألعاب وفعاليات تحتاج تفكير 🧠' },
    music: { title: '🎵 الموسيقى', color: UI.COLORS.music, desc: 'تشغيل وتحكم بالفويس.' },
    tickets: { title: '🎫 التكتات والأنظمة', color: UI.COLORS.tickets, desc: 'الدعم، الفورم، والردود التلقائية.' },
    admin: { title: '🛡️ الإدارة والإشراف', color: UI.COLORS.mod, desc: 'أوامر الإدارة والحماية والسجلات.' },
    roles: { title: '🎭 الرتب', color: UI.COLORS.info, desc: 'إدارة الرتب.' },
    info: { title: 'ℹ️ معلومات وأدوات', color: UI.COLORS.primary, desc: 'معلومات السيرفر والعضو وأدوات البوت.' },
    other: { title: '✨ أخرى', color: UI.COLORS.muted, desc: 'أوامر أخرى.' }
};

function permTextFromCommand(cmd) {
    try {
        const json = cmd && cmd.data && typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : null;
        const raw = json && json.default_member_permissions ? String(json.default_member_permissions) : '';
        if (!raw) return null;
        const bits = BigInt(raw);
        if (!bits) return null;
        const arr = new PermissionsBitField(bits).toArray();
        if (!arr || arr.length === 0) return null;
        return arr.slice(0, 2).join(' + ') + (arr.length > 2 ? ` +${arr.length - 2}` : '');
    } catch {
        return null;
    }
}

function categorizeCommand(name) {
    const n = String(name || '').toLowerCase();
    const groups = {
        shop: ['shop', 'shopadminui', 'inventory', 'use', 'gift', 'topshop', 'daily', 'dailyconfig', 'lootboxes', 'boosts', 'runes', 'grantpoints'],
        progress: ['level', 'leaderboard', 'profile', 'grantxp', 'togglelevels', 'levelrewards'],
        fun: ['8ball', 'roll', 'coinflip', 'poll', 'events', 'mechanics'],
        music: ['play', 'music', 'queue', 'skip', 'nowplaying', 'joinvc'],
        tickets: ['tickets', 'forum', 'renameforum', 'suggestions', 'whispers', 'welcome', 'replies', 'autoreply', 'autoreact', 'shortcuts', 'specialchannels'],
        admin: ['ban', 'kick', 'timeout', 'warn', 'warnings', 'warnings_clear', 'clear', 'punishlog', 'aimod', 'automod', 'security', 'adminreport', 'adminui', 'logs', 'backup', 'ai'],
        roles: ['reactionrole'],
        info: ['ping', 'user', 'avatar', 'serverinfo', 'setupcheck', 'help', 'owner']
    };
    for (const [cat, names] of Object.entries(groups)) {
        if (names.includes(n)) return cat;
    }
    return 'other';
}

function buildCatalog(commands) {
    const entries = [...(commands ? commands.values() : [])]
        .filter((c) => c && c.data && c.data.name)
        .map((c) => {
            const json = typeof c.data.toJSON === 'function' ? c.data.toJSON() : {};
            const name = String(json.name || '').trim();
            return {
                name,
                desc: AR_DESC[name] || String(json.description || '').trim() || '—',
                perm: permTextFromCommand(c),
                cat: categorizeCommand(name)
            };
        })
        .filter((e) => e.name && e.name !== 'shortcuts')
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));

    const cats = {};
    for (const key of CATEGORY_ORDER) cats[key] = [];
    for (const e of entries) (cats[e.cat] || cats.other).push(e);
    return { cats, total: entries.length };
}

function homeEmbed(catalog, userTag) {
    const lines = CATEGORY_ORDER
        .filter((k) => (catalog.cats[k] || []).length)
        .map((k) => `> ${CATEGORY_META[k].title} — **${catalog.cats[k].length}** أمر`);

    return UI.embed({
        title: '📚 دليل أوامر لونا',
        description:
            `أهلاً! هذا كل اللي يقدر **لونا** تسويه ✨\n` +
            `اختار القسم من القائمة تحت 👇\n\n${lines.join('\n')}\n\n` +
            `📊 المجموع: **${catalog.total}** أمر`,
        color: UI.COLORS.help,
        footerText: `طلبته: ${userTag}`
    });
}

function categoryEmbed(catKey, catalog, userTag, page = 0) {
    const meta = CATEGORY_META[catKey] || CATEGORY_META.other;
    const items = catalog.cats[catKey] || [];
    const pages = UI.chunk(items, 12);
    const p = Math.max(0, Math.min(pages.length - 1, page));
    const lines = (pages[p] || []).map((c) => {
        const perm = c.perm ? ` \`${c.perm}\`` : '';
        return `• \`/${c.name}\` — ${c.desc}${perm}`;
    });

    return UI.embed({
        title: meta.title,
        description: `${meta.desc}\n\n${lines.length ? lines.join('\n') : 'ما فيه أوامر هنا.'}`,
        color: meta.color,
        footerText: pages.length > 1 ? `صفحة ${p + 1}/${pages.length} • طلبته: ${userTag}` : `طلبته: ${userTag}`
    });
}

function componentsFor(ownerId, catKey = 'home', page = 0, catalog = null) {
    const options = CATEGORY_ORDER
        .filter((k) => !catalog || (catalog.cats[k] || []).length)
        .map((k) => ({
            label: CATEGORY_META[k].title,
            value: k,
            description: `${(catalog && catalog.cats[k] ? catalog.cats[k].length : 0)} أمر`,
            default: catKey === k
        }));

    const rows = [];
    rows.push(UI.row(
        new StringSelectMenuBuilder()
            .setCustomId(`helpSelect:${ownerId}`)
            .setPlaceholder('📚 اختار القسم...')
            .addOptions(options.slice(0, 25))
    ));

    const navButtons = [
        UI.btn(`help:home:${ownerId}`, 'الرئيسية', { emoji: '🏠', style: catKey === 'home' ? ButtonStyle.Primary : ButtonStyle.Secondary }),
        UI.btn(`help:mechanics:${ownerId}`, 'دليل الأنظمة', { emoji: '📖', style: ButtonStyle.Secondary })
    ];

    if (catKey !== 'home' && catalog) {
        const items = catalog.cats[catKey] || [];
        const pages = UI.chunk(items, 12);
        if (pages.length > 1) {
            navButtons.push(UI.btn(`help:page:${catKey}:${Math.max(0, page - 1)}:${ownerId}`, 'السابق', { emoji: '◀️', disabled: page <= 0 }));
            navButtons.push(UI.btn(`help:page:${catKey}:${Math.min(pages.length - 1, page + 1)}:${ownerId}`, 'التالي', { emoji: '▶️', disabled: page >= pages.length - 1 }));
        }
    }

    rows.push(UI.row(...navButtons));
    return rows;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('عرض جميع الأوامر المتاحة'),

    async execute(interaction) {
        const commands = interaction.client && interaction.client.commands ? interaction.client.commands : null;
        const catalog = buildCatalog(commands);
        await interaction.reply({
            embeds: [homeEmbed(catalog, interaction.user.tag)],
            components: componentsFor(interaction.user.id, 'home', 0, catalog),
            ephemeral: true
        });
    },

    // أزرار: help:<key>:<owner> أو help:page:<cat>:<n>:<owner>
    async handleHelpButton(interaction, commands) {
        const parts = String(interaction.customId || '').split(':');
        const kind = parts[1] || 'home';
        let catKey = 'home';
        let page = 0;
        let owner = parts[parts.length - 1] || '';

        if (kind === 'page') {
            catKey = parts[2] || 'home';
            page = Math.floor(Number(parts[3]) || 0);
            owner = parts[4] || '';
        } else if (kind !== 'home' && kind !== 'mechanics') {
            catKey = kind;
            owner = parts[2] || '';
        }

        if (owner && interaction.user && String(interaction.user.id) !== String(owner)) {
            try {
                return interaction.reply({ content: 'هذا الـ /help مو لك 3: استخدم /help عشان يطلع لك.', ephemeral: true });
            } catch {
                return;
            }
        }

        // زر دليل الأنظمة يفتح /mechanics
        if (kind === 'mechanics') {
            const mechCmd = interaction.client && interaction.client.commands ? interaction.client.commands.get('mechanics') : null;
            if (mechCmd && typeof mechCmd.buildMechanicsEmbed === 'function') {
                const embed = mechCmd.buildMechanicsEmbed('home', interaction.user.tag);
                const rows = mechCmd.buildMechanicsRows ? mechCmd.buildMechanicsRows() : [];
                try {
                    return interaction.update({ embeds: [embed], components: rows });
                } catch {
                    return;
                }
            }
        }

        const catalog = buildCatalog(commands);
        const embed = catKey === 'home'
            ? homeEmbed(catalog, interaction.user.tag)
            : categoryEmbed(catKey, catalog, interaction.user.tag, page);

        try {
            return interaction.update({ embeds: [embed], components: componentsFor(owner || interaction.user.id, catKey, page, catalog) });
        } catch {
            try {
                return interaction.editReply({ embeds: [embed], components: componentsFor(owner || interaction.user.id, catKey, page, catalog) });
            } catch {
                return;
            }
        }
    },

    // قائمة الأقسام
    async handleHelpSelect(interaction, commands) {
        const owner = String(interaction.customId || '').split(':')[1] || '';
        if (owner && interaction.user && String(interaction.user.id) !== String(owner)) {
            try {
                return interaction.reply({ content: 'هذا الـ /help مو لك 3: استخدم /help عشان يطلع لك.', ephemeral: true });
            } catch {
                return;
            }
        }

        const catKey = Array.isArray(interaction.values) && interaction.values[0] ? String(interaction.values[0]) : 'home';
        const catalog = buildCatalog(commands);
        const embed = catKey === 'home'
            ? homeEmbed(catalog, interaction.user.tag)
            : categoryEmbed(catKey, catalog, interaction.user.tag, 0);

        try {
            return interaction.update({ embeds: [embed], components: componentsFor(owner || interaction.user.id, catKey, 0, catalog) });
        } catch {
            return;
        }
    }
};
