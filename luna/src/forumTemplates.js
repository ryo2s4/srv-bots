const { normalizeHexColor, parseButtonStyle, parseButtonOptions } = require('./forumUi');

const TEMPLATES = [
    {
        id: 'announce',
        label: '📰 إعلان رسمي',
        description: 'إعلان عام + زر أسئلة شائعة',
        embed: {
            title: '📰 إعلان',
            description: 'اكتب الإعلان هنا...',
            color: '#E7D3B0'
        },
        buttons: [
            {
                label: '❓ أسئلة شائعة',
                style: 'Secondary',
                options: [
                    { label: '📌 كيف أتواصل مع الإدارة؟', response: 'افتح تكت من لوحة التكتات أو راسل أحد الستاف.' },
                    { label: '🎁 كيف أستلم الجوائز؟', response: 'تواصل مع الستاف بعد الفوز وسيتم تسليمك الجائزة بإذن الله.' }
                ]
            }
        ]
    },
    {
        id: 'rules',
        label: '📜 القوانين',
        description: 'قوانين مختصرة + زر التفاصيل',
        embed: {
            title: '📜 قوانين السيرفر',
            description: '1) احترام الجميع\n2) ممنوع السبام\n3) ممنوع الروابط المخالفة\n\nملاحظة: مخالفة القوانين تعرضك للعقوبة.',
            color: '#E7D3B0'
        },
        buttons: [
            {
                label: '📌 تفاصيل أكثر',
                style: 'Primary',
                options: [
                    { label: '🚫 السبام', response: 'ممنوع تكرار الرسائل/المنشنات بكثرة.' },
                    { label: '🔗 الروابط', response: 'ممنوع روابط مشبوهة أو دعائية بدون إذن.' }
                ]
            }
        ]
    },
    {
        id: 'events',
        label: '🎉 فعاليات',
        description: 'شرح سريع للفعاليات + زر الأسئلة',
        embed: {
            title: '🎉 فعاليات السيرفر',
            description: 'تابع روم الفعاليات — أول واحد يشارك صح يفوز ✨\n\nإذا ما فهمت شيء، اضغط زر الأسئلة تحت 👇',
            color: '#E7D3B0'
        },
        buttons: [
            {
                label: '❓ كيف أشارك؟',
                style: 'Success',
                options: [
                    { label: '🎯 المشاركة', response: 'ادخل روم الفعاليات واضغط الزر/اختر الخيار بسرعة قبل انتهاء الوقت.' },
                    { label: '⏳ مدة الفعالية', response: 'كل فعالية لها مدة محددة—إذا انتهت قبل ما تشارك، بتروح عليك.' }
                ]
            }
        ]
    },
    {
        id: 'support',
        label: '🆘 الدعم والمساعدة',
        description: 'طريقة طلب المساعدة + زر خيارات',
        embed: {
            title: '🆘 تحتاج مساعدة؟',
            description: 'لا تشيل هم—لونا معك 🌙\n\nافتح تكت وشرح مشكلتك، والستاف بيرد عليك بأقرب وقت.',
            color: '#E7D3B0'
        },
        buttons: [
            {
                label: '📨 قبل ما تفتح تكت',
                style: 'Secondary',
                options: [
                    { label: '📝 وش أكتب بالتكت؟', response: 'اكتب المشكلة + صور/روابط إن وجدت + متى صارت.' },
                    { label: '⏱️ متى يردون؟', response: 'غالبًا قريب، وإذا تأخروا شوي اعذرهم—يمكن ضغط.' }
                ]
            }
        ]
    },
    {
        id: 'apply',
        label: '📝 تقديم/انضمام',
        description: 'نموذج بسيط للتقديم + زر أسئلة',
        embed: {
            title: '📝 التقديم',
            description: 'إذا حاب تقدم، اكتب التالي برسالة وحدة:\n- اسمك\n- عمرك\n- خبرتك\n- ليه تبغى تنضم؟',
            color: '#E7D3B0'
        },
        buttons: [
            {
                label: '❓ أسئلة التقديم',
                style: 'Primary',
                options: [
                    { label: '✅ متى ينرد علي؟', response: 'عادة خلال 24-48 ساعة حسب توفر الإدارة.' },
                    { label: '📌 هل لازم خبرة؟', response: 'مو شرط—المهم احترامك والتزامك.' }
                ]
            }
        ]
    },
    {
        id: 'welcome',
        label: '👋 ترحيب',
        description: 'ترحيب لطيف + زر التعريف بالسيرفر',
        embed: {
            title: '👋 أهلًا وسهلًا!',
            description: 'نورت/ي السيرفر ✨\n\nخلك لطيف، استمتع، وإذا احتجت شيء افتح تكت 🫶',
            color: '#E7D3B0'
        },
        buttons: [
            {
                label: '⭐ وين أبدأ؟',
                style: 'Success',
                options: [
                    { label: '💬 الرومات', response: 'ابدأ برومات الدردشة العامة وتعرف على الأعضاء.' },
                    { label: '🎉 الفعاليات', response: 'تابع روم الفعاليات—فيه جوائز وحماس.' }
                ]
            }
        ]
    }
];

function listTemplates() {
    return TEMPLATES.map(t => ({ id: t.id, label: t.label, description: t.description }));
}

function getTemplateById(id) {
    return TEMPLATES.find(t => String(t.id) === String(id)) || null;
}

function applyTemplateToDraft(draft, templateId) {
    const tpl = getTemplateById(templateId);
    if (!tpl || !draft) return null;

    const embed = {
        ...(draft.embed && typeof draft.embed === 'object' ? draft.embed : {}),
        ...(tpl.embed || {})
    };
    if (embed.color) embed.color = normalizeHexColor(embed.color);

    const buttons = Array.isArray(tpl.buttons) ? tpl.buttons.slice(0, 5).map(b => ({
        label: String(b.label || '').slice(0, 80),
        style: parseButtonStyle(b.style || 'Secondary'),
        options: Array.isArray(b.options) ? b.options : parseButtonOptions(String(b.options || ''))
    })) : [];

    return { embed, buttons };
}

module.exports = { listTemplates, getTemplateById, applyTemplateToDraft }; 
