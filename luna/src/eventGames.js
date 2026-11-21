// نظام ألعاب الفعاليات — كل لعبة تحتاج تفكير وفهم 🧠
// كل لعبة (عدا الألعاب الخاصة ضد البوت) تُبنى كسؤال بخيارات، والجواب يُحفظ في meta
// (ما ينحط في custom_id عشان ما يقدر أحد يقرأ الجواب من الكود).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ---------- helpers ----------
function randInt(n) { return Math.floor(Math.random() * n); }
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const RULES_LINE = '⚠️ **أول جواب صح = فوز ونهاية الفعالية فورًا** · والجواب الغلط = خروج بدون إعادة 👋';

function quizDescription(question, reward, until) {
    return [
        question,
        '',
        RULES_LINE,
        `🎁 المكافأة: **${reward}** Luna Points 🌙`,
        `⏳ تنتهي بعد: <t:${Math.floor(until / 1000)}:R>`
    ].join('\n');
}

function quizRow(opts) {
    const row = new ActionRowBuilder();
    opts.forEach((o, i) => {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`event:ans:${i}`)
                .setLabel(String(o).slice(0, 80))
                .setStyle(ButtonStyle.Secondary)
        );
    });
    return row;
}

// يبني خيارات مرتبة عشوائيًا مع تثبيت مكان الجواب الصحيح
function buildChoices(correct, traps) {
    const seen = new Set([String(correct)]);
    const opts = [correct];
    for (const t of traps) {
        if (opts.length >= 4) break;
        if (t === null || t === undefined) continue;
        if (typeof t === 'number' && !Number.isFinite(t)) continue;
        if (typeof correct === 'number' && typeof t === 'number' && !Number.isInteger(t)) continue;
        const key = String(t);
        if (seen.has(key)) continue;
        seen.add(key);
        opts.push(t);
    }
    if (typeof correct === 'number') {
        let k = 1;
        while (opts.length < 4) {
            const cand = correct + (opts.length % 2 === 0 ? k : -k);
            if (!seen.has(String(cand))) {
                seen.add(String(cand));
                opts.push(cand);
            }
            k++;
        }
    } else {
        let k = 2;
        while (opts.length < 4) {
            const cand = `${correct} ${k}`;
            if (!seen.has(cand)) {
                seen.add(cand);
                opts.push(cand);
            }
            k++;
        }
    }
    const shuffled = shuffle(opts);
    return { opts: shuffled, correctIdx: shuffled.findIndex((x) => String(x) === String(correct)) };
}

function wrapQuiz(type, { reward, until, title, question, correct, traps, record = {} }) {
    const { opts, correctIdx } = buildChoices(correct, traps);
    return {
        embed: new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle(title)
            .setDescription(quizDescription(question, reward, until))
            .setTimestamp(),
        components: [quizRow(opts)],
        meta: {
            type,
            until,
            reward,
            winnersCount: 1,
            winners: [],
            eliminated: [],
            messageId: null,
            channelId: null,
            correctIdx,
            options: opts.map(String),
            ...record
        }
    };
}

function wrapSpecial(type, { reward, until, title, description, components, record = {} }) {
    return {
        embed: new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle(title)
            .setDescription([
                description,
                '',
                RULES_LINE,
                `🎁 المكافأة: **${reward}** Luna Points 🌙`,
                `⏳ تنتهي بعد: <t:${Math.floor(until / 1000)}:R>`
            ].join('\n'))
            .setTimestamp(),
        components,
        meta: {
            type,
            until,
            reward,
            winnersCount: 1,
            winners: [],
            eliminated: [],
            messageId: null,
            channelId: null,
            ...record
        }
    };
}

// ---------- محتوى الألعاب ----------

// 1) حساب متسلسل: قواعد الأولويات (ضرب/قسمة قبل جمع/طرح)
function buildMathQuick(ctx) {
    const templates = [
        () => {
            const a = 4 + randInt(9), b = 2 + randInt(8), c = 3 + randInt(9), d = 1 + randInt(8);
            return { expr: `${a} + ${b} × ${c} - ${d}`, val: a + b * c - d, traps: [(a + b) * c - d, a + b * (c - d), a + b * c + d] };
        },
        () => {
            const a = 3 + randInt(8), b = 2 + randInt(7), c = 2 + randInt(8), d = 2 + randInt(6);
            return { expr: `${a} × ${b} - ${c} × ${d}`, val: a * b - c * d, traps: [a * (b - c) * d, (a - b) * c * d, a * b - c + d] };
        },
        () => {
            const a = 2 + randInt(7), b = 2 + randInt(7), c = 2 + randInt(8), d = 1 + randInt(9);
            return { expr: `(${a} + ${b}) × ${c} - ${d}`, val: (a + b) * c - d, traps: [a + b * c - d, (a + b) * (c - d), (a + b) * c + d] };
        },
        () => {
            const a = 3 + randInt(9), b = 2 + randInt(6), c = 2 + randInt(7), d = 2 + randInt(6);
            return { expr: `${a} × ${b} + ${c} × ${d}`, val: a * b + c * d, traps: [(a + b) * (c + d), a * (b + c) * d, a * b + c + d] };
        },
        () => {
            const a = 2 + randInt(8), b = 2 + randInt(8), e = 2 + randInt(6), k = 2 + randInt(8), c = 3 + randInt(9);
            const d = e * k;
            return { expr: `${a} × ${b} + ${d} ÷ ${e} - ${c}`, val: a * b + k - c, traps: [(a * b + d) / e - c, a * b + k + c, (a + b) * k - c] };
        },
        () => {
            const a = 5 + randInt(10), b = 3 + randInt(8), c = 2 + randInt(9), d = 2 + randInt(7);
            return { expr: `${a} × (${b} - ${c}) + ${d}`, val: a * (b - c) + d, traps: [a * b - c + d, a * (b - c + d), (a * b - c) * d] };
        }
    ];
    const t = pickOne(templates)();
    return wrapQuiz('math_quick', {
        ...ctx,
        title: '🧮 فعالية: حساب متسلسل',
        question: `احسب الناتج مع مراعاة **أولوية العمليات**:\n\n\`${t.expr} = ؟\``,
        correct: t.val,
        traps: t.traps
    });
}

// 2) المختلف: خاصية مشتركة دقيقة
const ODD_BANK = [
    { q: 'الأربعة تشترك في خاصية رياضية واحدة… إلا واحد. مين المختلف؟', opts: ['4', '9', '25', '36'], odd: '36' },
    { q: 'فيهم خاصية مشتركة… إلا واحد. مين المختلف؟', opts: ['13', '17', '21', '19'], odd: '21' },
    { q: 'فيهم خاصية مشتركة… إلا واحد. مين المختلف؟', opts: ['8', '16', '32', '48'], odd: '48' },
    { q: 'فيهم خاصية مشتركة… إلا واحد. مين المختلف؟', opts: ['14', '21', '28', '33'], odd: '33' },
    { q: 'فيهم خاصية مشتركة… إلا واحد. مين المختلف؟', opts: ['2', '3', '5', '9'], odd: '9' },
    { q: 'فيهم خاصية مشتركة… إلا واحد. مين المختلف؟', opts: ['12', '18', '27', '32'], odd: '32' },
    { q: 'ثلاثة منهم مرادفات لكلمة (سريع)… والرابع لا. مين المختلف؟', opts: ['سريع', 'خاطف', 'عاجل', 'بطيء'], odd: 'بطيء' },
    { q: 'ثلاثة منهم مرادفات… والرابع عكسها. مين المختلف؟', opts: ['قمة', 'ذروة', 'منتهى', 'قاع'], odd: 'قاع' },
    { q: 'ثلاثة منهم مرادفات لكلمة (شجاع)… والرابع عكسها. مين المختلف؟', opts: ['شجاع', 'باسل', 'جسور', 'جبان'], odd: 'جبان' },
    { q: 'ثلاثة منهم جمع مذكر سالم… والرابع لا. مين المختلف؟', opts: ['مهندسين', 'أطباء', 'معلمين', 'طالب'], odd: 'طالب' },
    { q: 'ثلاثة منهم أزمنة فعل… والرابع ليس فعلًا. مين المختلف؟', opts: ['مضارع', 'ماضي', 'أمر', 'اسم'], odd: 'اسم' },
    { q: 'ثلاثة منهم على وزن (استفعل)… والرابع لا. مين المختلف؟', opts: ['استخرج', 'استمع', 'استقبل', 'جلس'], odd: 'جلس' },
    { q: 'ثلاثة منهم مصادر (أسماء مصادر)… والرابع ليس مصدرًا. مين المختلف؟', opts: ['الكتابة', 'القراءة', 'السماع', 'الجامعة'], odd: 'الجامعة' },
    { q: 'ثلاثة منهم وحدات لقياس الطول… والرابع لشيء آخر. مين المختلف؟', opts: ['المتر', 'السنتيمتر', 'الكيلومتر', 'اللتر'], odd: 'اللتر' }
];

function buildOddOneOut(ctx) {
    const p = pickOne(ODD_BANK);
    return wrapQuiz('odd_one_out', {
        ...ctx,
        title: '🧩 فعالية: المختلف',
        question: p.q,
        correct: p.odd,
        traps: p.opts.filter((x) => x !== p.odd)
    });
}

// 3) المجرم: واحد يخالف القاعدة (رياضية/لغوية)
const IMPOSTER_BANK = [
    { hint: 'القاعدة رياضية… واحد يخالفها.', items: ['16', '25', '36', '44'], imp: '44' },
    { hint: 'القاعدة رياضية… واحد يخالفها.', items: ['2', '5', '11', '15'], imp: '15' },
    { hint: 'القاعدة رياضية… واحد يخالفها.', items: ['121', '144', '169', '200'], imp: '200' },
    { hint: 'القاعدة رياضية… واحد يخالفها.', items: ['2', '4', '8', '18'], imp: '18' },
    { hint: 'القاعدة رياضية… واحد يخالفها.', items: ['8', '12', '16', '17'], imp: '17' },
    { hint: 'القاعدة رياضية… واحد يخالفها.', items: ['10', '20', '30', '45'], imp: '45' },
    { hint: 'القاعدة رقمية… واحد يخالفها.', items: ['121', '232', '343', '455'], imp: '455' },
    { hint: 'القاعدة رقمية… واحد يخالفها.', items: ['111', '222', '334', '444'], imp: '334' },
    { hint: 'القاعدة لغوية (شكل الحرف)… واحد يخالفها.', items: ['ب', 'ت', 'ث', 'ج'], imp: 'ج' },
    { hint: 'القاعدة: تصنيف المفاهيم… واحد يخالفها.', items: ['نجم', 'مذنب', 'كوكب', 'طائر'], imp: 'طائر' },
    { hint: 'القاعدة: تصنيف المفاهيم… واحد يخالفها.', items: ['تفاح', 'موز', 'عنب', 'جزر'], imp: 'جزر' }
];

function buildFindImposter(ctx) {
    const p = pickOne(IMPOSTER_BANK);
    return wrapQuiz('find_imposter', {
        ...ctx,
        title: '🕵️ فعالية: اكشف المجرم',
        question: `${p.hint}\n\n${p.items.map((x) => `**${x}**`).join(' · ')}`,
        correct: p.imp,
        traps: p.items.filter((x) => x !== p.imp),
        record: { answer: p.imp }
    });
}

// 4) معلومات عامة (أسئلة صعبة تحتاج معرفة وفهم)
const TRIVIA_HARD = [
    { q: 'ما هي عاصمة أستراليا؟', a: 'كانبرا', opts: ['سيدني', 'ملبورن', 'كانبرا', 'بريزبين'] },
    { q: 'ما هي أطول سلسلة جبال في العالم؟', a: 'الأنديز', opts: ['الهيمالايا', 'الأنديز', 'الألب', 'جبال الروكي'] },
    { q: 'كم عدد قلوب الأخطبوط؟', a: '3', opts: ['1', '2', '3', '4'] },
    { q: 'ما هي أصغر عظمة في جسم الإنسان؟', a: 'الركاب (في الأذن)', opts: ['الركاب (في الأذن)', 'عظمة الرسغ', 'عظمة المسمار', 'سلامية اليد'] },
    { q: 'من رسم لوحة "الصرخة"؟', a: 'إدفارت مونك', opts: ['فان غوخ', 'إدفارت مونك', 'بيكاسو', 'سلفادور دالي'] },
    { q: 'ما هي العملة الرسمية في سويسرا؟', a: 'الفرنك السويسري', opts: ['اليورو', 'الفرنك السويسري', 'الكرونة', 'الجنيه'] },
    { q: 'ما الغاز الأكثر انتشارًا في غلافنا الجوي؟', a: 'النيتروجين', opts: ['الأكسجين', 'النيتروجين', 'ثاني أكسيد الكربون', 'الهيليوم'] },
    { q: 'ما هي أكبر صحراء حارة في العالم؟', a: 'الصحراء الكبرى', opts: ['الصحراء الكبرى', 'صحراء غوبي', 'صحراء أتاكاما', 'الربع الخالي'] },
    { q: 'ماذا يقيس البارومتر؟', a: 'الضغط الجوي', opts: ['الرطوبة', 'الضغط الجوي', 'سرعة الرياح', 'الارتفاع'] },
    { q: 'كم عدد فقرات عمود الإنسان الفقري؟', a: '33', opts: ['24', '26', '33', '40'] },
    { q: 'أي لغة يتحدث بها أكبر عدد من الناس كلغة أم؟', a: 'الصينية الماندرين', opts: ['الإنجليزية', 'الإسبانية', 'الصينية الماندرين', 'العربية'] },
    { q: 'على قمة جبل مرتفع، درجة غليان الماء تكون...', a: 'أقل من 100 مئوية', opts: ['أعلى من 100 مئوية', 'أقل من 100 مئوية', '100 مئوية تمامًا', 'لا يغلي أبدًا'] },
    { q: 'ما الفرق بين الكتلة والوزن؟', a: 'الكتلة ثابتة والوزن يتغير بحسب الجاذبية', opts: ['الكتلة ثابتة والوزن يتغير بحسب الجاذبية', 'هما الشيء نفسه', 'الكتلة تتغير مع الجاذبية', 'الوزن يُقاس بالغرام فقط'] },
    { q: 'لماذا يطفو الخشب على الماء؟', a: 'لأن كثافته أقل من كثافة الماء', opts: ['لأن كثافته أقل من كثافة الماء', 'لأنه يحتوي هواءً فقط', 'لأن الماء يدفع كل شيء', 'لأن وزنه صفر'] },
    { q: 'ما هي أصغر قارة من حيث المساحة؟', a: 'أستراليا', opts: ['أوروبا', 'أستراليا', 'القارة القطبية الجنوبية', 'أمريكا الجنوبية'] },
    { q: 'ماذا يحدث لضغط الغاز إذا حُبس في حاوية أصغر؟', a: 'يزداد', opts: ['ينخفض', 'يزداد', 'لا يتغير', 'يتحول إلى سائل دائمًا'] },
    { q: 'أي الكواكب يدور حول نفسه بعكس اتجاه دوران معظم الكواكب؟', a: 'الزهرة', opts: ['الزهرة', 'المريخ', 'المشتري', 'عطارد'] },
    { q: 'من هو أول إنسان صعد إلى الفضاء؟', a: 'يوري غاغارين', opts: ['نيل أرمسترونغ', 'يوري غاغارين', 'بز ألدرين', 'جون غلين'] },
    { q: 'ماذا يُقاس بـ (الهرتز)؟', a: 'التردد', opts: ['التردد', 'الضغط', 'الشحنة الكهربائية', 'الحرارة'] }
];

function buildTriviaQuiz(ctx) {
    const q = pickOne(TRIVIA_HARD);
    return wrapQuiz('trivia_quiz', {
        ...ctx,
        title: '🧠 فعالية: معلومات عامة',
        question: `**${q.q}**`,
        correct: q.a,
        traps: q.opts.filter((x) => x !== q.a),
        record: { answer: q.a }
    });
}

// 5) فك الشفرة: كلمة مبعثرة + تعريف
const SCRAMBLE_BANK = [
    { w: 'ELEPHANT', hint: 'أكبر حيوان بري على وجه الأرض' },
    { w: 'MOUNTAIN', hint: 'ارتفاع طبيعي مرتفع عن سطح الأرض' },
    { w: 'COMPUTER', hint: 'جهاز إلكتروني يُستخدم للحسابات والعمل' },
    { w: 'BUTTERFLY', hint: 'حشرة ملونة تطير بين الزهور' },
    { w: 'NOTEBOOK', hint: 'تكتب فيه ملاحظاتك' },
    { w: 'WATERMELON', hint: 'فاكهة صيفية كبيرة حمراء من الداخل' },
    { w: 'TELEPHONE', hint: 'تستخدمه للتواصل عن بعد' },
    { w: 'CROCODILE', hint: 'زاحف ضخم يعيش قرب المياه' },
    { w: 'KANGAROO', hint: 'حيوان يقفز ويعيش في أستراليا' },
    { w: 'PENGUIN', hint: 'طير لا يطير ويعيش في المناطق الباردة' },
    { w: 'LIBRARY', hint: 'مكان الكتب والقراءة' },
    { w: 'BACKPACK', hint: 'حقيبة تُحمل على الظهر' }
];

function scrambleWord(w) {
    const letters = w.split('');
    for (let i = 0; i < 20 && letters.join('') === w; i++) {
        for (let j = letters.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [letters[j], letters[k]] = [letters[k], letters[j]];
        }
    }
    return letters.join('');
}

function buildWordScramble(ctx) {
    const picked = pickOne(SCRAMBLE_BANK);
    const distractors = shuffle(SCRAMBLE_BANK.filter((x) => x.w !== picked.w)).slice(0, 3).map((x) => x.w);
    return wrapQuiz('word_scramble', {
        ...ctx,
        title: '🔤 فعالية: فك الشفرة',
        question: `الحروف مبعثرة… رتّبها وطلع الكلمة:\n\n\`${scrambleWord(picked.w)}\`\n\nالدلالة: **${picked.hint}**`,
        correct: picked.w,
        traps: distractors,
        record: { answer: picked.w }
    });
}

// 6) الألغاز (صعبة وتحتاج تفكير جانبي)
const RIDDLE_BANK = [
    { q: 'ما هو الشيء الذي تملكه أنت، لكن الآخرين يستخدمونه أكثر منك؟', a: 'اسمك', opts: ['اسمك', 'هاتفك', 'بيتك', 'وقتك'] },
    { q: 'كلما أخذت منه كبر... ما هو؟', a: 'الحفرة', opts: ['الحفرة', 'الحقيبة', 'البالون', 'الظل'] },
    { q: 'ما هو الشيء الذي يزيد كلما شاركته الآخرين؟', a: 'المعرفة', opts: ['المعرفة', 'المال', 'الطعام', 'الوقت'] },
    { q: 'ما هو الشيء الذي يسير أمامك دائمًا لكنك لا تستطيع رؤيته؟', a: 'المستقبل', opts: ['المستقبل', 'الظل', 'الهواء', 'الوقت'] },
    { q: 'شيء كلما زاد نقص... ما هو؟', a: 'العمر', opts: ['العمر', 'الوزن', 'المال', 'الحذاء'] },
    { q: 'إذا ذكرته اختفى، وإذا نسيته ظهر؟', a: 'الصمت', opts: ['الصمت', 'النوم', 'الظل', 'الخوف'] },
    { q: 'بيت بلا باب ولا نافذة؟', a: 'بيت الشعر', opts: ['بيت الشعر', 'بيت العنكبوت', 'الخيمة', 'الكهف'] },
    { q: 'ما هو الشيء الذي يوجد في وسط باريس؟', a: 'حرف الراء', opts: ['حرف الراء', 'برج إيفل', 'نهر السين', 'متحف اللوفر'] },
    { q: 'له رقبة ولا له رأس؟', a: 'الزجاجة', opts: ['الزجاجة', 'الدب', 'الكرسي', 'الجمل'] },
    { q: 'شيء يُطير بلا جناح ويبكي بلا عيون؟', a: 'السحاب', opts: ['السحاب', 'الريح', 'الوقت', 'الطائرة'] },
    { q: 'شيء يموت إذا سقط عليه الماء؟', a: 'النار', opts: ['النار', 'السمك', 'التراب', 'الهواء'] }
];

function buildRiddleMe(ctx) {
    const r = pickOne(RIDDLE_BANK);
    return wrapQuiz('riddle_me', {
        ...ctx,
        title: '🤔 فعالية: لغز يحتاج تركيز',
        question: `**${r.q}**`,
        correct: r.a,
        traps: r.opts.filter((x) => x !== r.a),
        record: { answer: r.a }
    });
}

// 7) الكلمة المخفية: تعريف + أول حرف
const LETTER_WORD_BANK = [
    { letter: 'س', q: 'أداة تُستخدم لقياس الزمن وتعلق على الجدار؟', a: 'ساعة', opts: ['ساعة', 'سراج', 'سفينة', 'سلة'] },
    { letter: 'ق', q: 'حيوان يُعرف بتشابهه مع الإنسان ويتسلق الأشجار؟', a: 'قرد', opts: ['قرد', 'قط', 'غزال', 'حمامة'] },
    { letter: 'ط', q: 'مادة بيضاء تُكتب بها على السبورة؟', a: 'طباشير', opts: ['طباشير', 'طماطم', 'طائرة', 'طبل'] },
    { letter: 'م', q: 'أكبر كواكب المجموعة الشمسية؟', a: 'المشتري', opts: ['المشتري', 'المريخ', 'عطارد', 'الزهرة'] },
    { letter: 'ل', q: 'فاكهة حامضة صفراء تُستخدم في العصائر؟', a: 'ليمون', opts: ['ليمون', 'لوز', 'لحم', 'لوبيا'] },
    { letter: 'ب', q: 'طائر أليف يسبح في الماء ويضع البيض؟', a: 'بطة', opts: ['بطة', 'ببغاء', 'بومة', 'بقرة'] },
    { letter: 'م', q: 'أداة تُستخدم لفتح الأقفال؟', a: 'مفتاح', opts: ['مفتاح', 'مطرقة', 'مصباح', 'مروحة'] },
    { letter: 'ش', q: 'النجم الذي يمنح الأرض الضوء والدفء؟', a: 'الشمس', opts: ['الشمس', 'شمعة', 'شجرة', 'شلال'] },
    { letter: 'ف', q: 'فاكهة حمراء صغيرة حلوة المذاق تنمو قرب سطح الأرض؟', a: 'فراولة', opts: ['فراولة', 'فجل', 'فول', 'فلفل'] },
    { letter: 'ب', q: 'فاكهة برتقالية اللون غنية بفيتامين C؟', a: 'برتقال', opts: ['برتقال', 'بطيخ', 'بصل', 'بازلاء'] }
];

function buildLetterWord(ctx) {
    const p = pickOne(LETTER_WORD_BANK);
    return wrapQuiz('letter_word', {
        ...ctx,
        title: '🔠 فعالية: الكلمة المخفية',
        question: `الكلمة تبدأ بحرف (**${p.letter}**) وتعني:\n\n**${p.q}**`,
        correct: p.a,
        traps: p.opts.filter((x) => x !== p.a),
        record: { answer: p.a }
    });
}

// 8) معادلات الإيموجي: نظام معادلات بثلاث مجهولات
function buildEmojiEquations(ctx) {
    const a = 2 + randInt(8), b = 2 + randInt(8), c = 2 + randInt(8);
    const [E1, E2, E3] = ['🍎', '🍇', '🍌'];
    const eqs = [
        `${E1} + ${E1} = **${a + a}**`,
        `${E1} + ${E2} = **${a + b}**`,
        `${E2} + ${E3} = **${b + c}**`
    ];
    const variants = [
        { q: `${E1} + ${E2} + ${E3} = ؟`, val: a + b + c, traps: [a + b + c + 2, a + b + c - 2, 2 * a + b] },
        { q: `${E1} + ${E3} = ؟`, val: a + c, traps: [a + c + 2, a + c - 1, a + b + c] },
        { q: `(${E2} × 2) + ${E3} = ؟`, val: 2 * b + c, traps: [2 * b + c + 2, b + c, 2 * a + c] }
    ];
    const v = pickOne(variants);
    return wrapQuiz('emoji_meaning', {
        ...ctx,
        title: '🍎 فعالية: معادلات الإيموجي',
        question: `${eqs.join('\n')}\n\nاعرف قيمة كل إيموجي، ثم حسب:\n\n**${v.q}**`,
        correct: v.val,
        traps: v.traps,
        record: { values: { [E1]: a, [E2]: b, [E3]: c } }
    });
}

// 9) التقاطع: عنصر ينتمي لفئتين معًا
const CATEGORY_BANK = [
    { q: 'أي عنصر ينتمي إلى (الطيور) **و** (لا يطير)؟', a: '🐧', opts: ['🐧', '🦅', '🐦', '✈️'] },
    { q: 'أي عنصر ينتمي إلى (الفواكه) **و** (لونه داخليًا أحمر)؟', a: '🍉', opts: ['🍉', '🍈', '🥝', '🍋'] },
    { q: 'أي عنصر ينتمي إلى (الأجرام الفلكية) **و** (يدور حول نجم)؟', a: '🪐', opts: ['🪐', '☀️', '🌙', '⭐'] },
    { q: 'أي عنصر ينتمي إلى (الخضروات) **و** (لونه برتقالي)؟', a: 'جزر', opts: ['جزر', 'خس', 'باذنجان', 'بطيخ'] },
    { q: 'أي عنصر ينتمي إلى (أدوات الكتابة) **و** (يحتاج حبرًا ليعمل)؟', a: 'قلم حبر', opts: ['قلم حبر', 'قلم رصاص', 'مسطرة', 'ممحاة'] },
    { q: 'أي عنصر ينتمي إلى (الحشرات) **و** (يُنتج شيئًا نأكله)؟', a: 'نحلة', opts: ['نحلة', 'نملة', 'فراشة', 'جرادة'] },
    { q: 'أي عنصر ينتمي إلى (الكواكب) **و** (له حلقات واضحة)؟', a: 'زحل', opts: ['زحل', 'الأرض', 'المريخ', 'عطارد'] },
    { q: 'أي عنصر ينتمي إلى (المشروبات) **و** (يُصنع من الحليب)؟', a: 'لبن', opts: ['لبن', 'قهوة', 'عصير', 'مشروب غازي'] }
];

function buildCategoryClash(ctx) {
    const p = pickOne(CATEGORY_BANK);
    return wrapQuiz('category_clash', {
        ...ctx,
        title: '📂 فعالية: التقاطع',
        question: `اختار العنصر الذي يحقق **الشرطين معًا**:\n\n${p.q}`,
        correct: p.a,
        traps: p.opts.filter((x) => x !== p.a),
        record: { answer: p.a }
    });
}

// 10) English (idioms + grammar + vocab)
const TRIVIA_EN = [
    { q: 'What does "break the ice" mean?', a: 'To start a conversation in an awkward situation', opts: ['To start a conversation in an awkward situation', 'To break something made of ice', 'To end a friendship', 'To cool down a room'] },
    { q: 'What does "once in a blue moon" mean?', a: 'Very rarely', opts: ['Very often', 'Very rarely', 'Immediately', 'During the night'] },
    { q: 'Choose the correct sentence:', a: 'She has been living here for ten years.', opts: ['She is living here since ten years.', 'She has been living here for ten years.', 'She lives here since ten years.', 'She living here for ten years.'] },
    { q: 'What is the opposite of "scarce"?', a: 'Abundant', opts: ['Rare', 'Abundant', 'Limited', 'Small'] },
    { q: 'Complete: If I ____ rich, I would travel the world.', a: 'were', opts: ['am', 'was', 'were', 'be'] },
    { q: '"To let the cat out of the bag" means:', a: 'To reveal a secret', opts: ['To free an animal', 'To reveal a secret', 'To make a mess', 'To be confused'] },
    { q: 'Which sentence uses "fewer" correctly?', a: 'There are fewer mistakes in this essay.', opts: ['There are fewer mistakes in this essay.', 'There is fewer water in the glass.', 'There are fewer money now.', 'I have fewer time than you.'] },
    { q: 'What is the meaning of "reluctant"?', a: 'Unwilling', opts: ['Eager', 'Unwilling', 'Careless', 'Quick'] },
    { q: 'What does "hit the books" mean?', a: 'To study hard', opts: ['To throw books', 'To study hard', 'To buy books', 'To be angry'] },
    { q: 'Choose the correct word order:', a: 'She rarely drinks coffee at night.', opts: ['She drinks rarely coffee at night.', 'She rarely drinks coffee at night.', 'Rarely she coffee drinks at night.', 'She drinks coffee rarely night at.'] }
];

function buildTriviaEn(ctx) {
    const q = pickOne(TRIVIA_EN);
    return wrapQuiz('trivia_en', {
        ...ctx,
        title: '🌍 فعالية: English Challenge',
        question: `**${q.q}**`,
        correct: q.a,
        traps: q.opts.filter((x) => x !== q.a),
        record: { answer: q.a }
    });
}

// ===== الألعاب الجديدة =====

// 11) الجبر: إيجاد المجهول
function buildMathAlgebra(ctx) {
    const a = 2 + randInt(8), x = 2 + randInt(11), b = 1 + randInt(20);
    const c = a * x + b;
    return wrapQuiz('math_algebra', {
        ...ctx,
        title: '➗ فعالية: احسب (س)',
        question: `إذا كانت العلاقة:\n\n\`${a} س + ${b} = ${c}\`\n\nفكم قيمة (**س**)؟`,
        correct: x,
        traps: [x + 1, x - 1, x + 2, Math.max(1, Math.round(c / a))]
    });
}

// 12) التسلسل: اكتشف القاعدة
const SEQUENCE_BANK = [
    { s: [2, 4, 7, 11], a: 16, t: [15, 17, 14] },
    { s: [1, 4, 9, 16], a: 25, t: [20, 24, 32] },
    { s: [3, 7, 15, 31], a: 63, t: [47, 62, 64] },
    { s: [2, 3, 5, 8, 13], a: 21, t: [18, 20, 26] },
    { s: [5, 10, 8, 16, 14], a: 28, t: [24, 26, 30] },
    { s: [1, 2, 4, 8, 16], a: 32, t: [24, 30, 34] },
    { s: [100, 90, 81, 73], a: 66, t: [65, 67, 64] },
    { s: [1, 3, 6, 10, 15], a: 21, t: [18, 20, 25] },
    { s: [2, 6, 12, 20, 30], a: 42, t: [40, 44, 36] },
    { s: [1, 8, 27, 64], a: 125, t: [81, 100, 121] },
    { s: [4, 9, 13, 22, 35], a: 57, t: [50, 55, 60] },
    { s: [5, 6, 8, 12, 20], a: 36, t: [28, 32, 38] }
];

function buildNumberSequence(ctx) {
    const p = pickOne(SEQUENCE_BANK);
    return wrapQuiz('number_sequence', {
        ...ctx,
        title: '📈 فعالية: التسلسل',
        question: `اكتشف قاعدة المتتالية وحدد العدد التالي:\n\n\`${p.s.join(' - ')} - ؟\``,
        correct: p.a,
        traps: p.t
    });
}

// 13) الترتيب المنطقي: استنتاج من أدلة
const LOGIC_ORDER_BANK = [
    {
        q: 'في سباق: وصل (د) قبل (أ)، ووصل (أ) قبل (ب)، ووصل (ب) قبل (ج). من وصل **الثاني**؟',
        a: 'أ', opts: ['أ', 'ب', 'ج', 'د']
    },
    {
        q: 'سلمى أطول من نورة، وريم أقصر من نورة. من **الأطول**؟',
        a: 'سلمى', opts: ['سلمى', 'نورة', 'ريم', 'لا يمكن تحديد']
    },
    {
        q: 'أربعة كتب: الأحمر أثقل من الأزرق، والأزرق أثقل من الأخضر، والأخضر أثقل من الأصفر. ما ترتيبها من الأثقل إلى الأخف؟',
        a: 'أحمر، أزرق، أخضر، أصفر', opts: ['أحمر، أزرق، أخضر، أصفر', 'أصفر، أخضر، أزرق، أحمر', 'أزرق، أحمر، أصفر، أخضر', 'أخضر، أزرق، أحمر، أصفر']
    },
    {
        q: '(ن) أكبر من (م)، و(م) أكبر من (ص)، و(ص) أكبر من (ع). من **الأصغر**؟',
        a: 'ع', opts: ['ن', 'م', 'ص', 'ع']
    },
    {
        q: 'ثلاثة إخوة: الولد الأكبر أقصر من الأوسط، والأصغر أطول من الأوسط. من **الأطول**؟',
        a: 'الأصغر', opts: ['الأكبر', 'الأوسط', 'الأصغر', 'لا يمكن تحديد']
    },
    {
        q: 'في امتحان: فاطمة أعلى من مريم، ومريم أعلى من سارة، وسارة أعلى من هند. من حصلت على **أدنى** درجة؟',
        a: 'هند', opts: ['فاطمة', 'مريم', 'سارة', 'هند']
    },
    {
        q: 'إذا كان كل (ب) هو (ج)، وبعض (ج) هو (د). هل يلزم أن كل (ب) هو (د)؟',
        a: 'لا يلزم', opts: ['نعم دائمًا', 'لا يلزم', 'نعم إذا كان (د) أكبر', 'لا أبدًا']
    },
    {
        q: 'خمس طلاب في صف: (ج) في المنتصف، (أ) يجلس يمين (ج) مباشرة، (ب) يجلس يسار (ج) مباشرة، و(د) في أقصى اليمين. من في أقصى اليسار؟',
        a: 'هـ', opts: ['أ', 'ب', 'هـ', 'د']
    }
];

function buildLogicOrder(ctx) {
    const p = pickOne(LOGIC_ORDER_BANK);
    return wrapQuiz('logic_order', {
        ...ctx,
        title: '🧩 فعالية: منطق وترتيب',
        question: `**${p.q}**\n\nفكّر خطوة بخطوة قبل ما تختار.`,
        correct: p.a,
        traps: p.opts.filter((x) => x !== p.a),
        record: { answer: p.a }
    });
}

// 14) الشفرة: إزاحة حروف (Caesar)
const CIPHER_WORDS = ['CAT', 'DOG', 'SUN', 'MOON', 'STAR', 'FIRE', 'LION', 'BOOK', 'KING', 'WOLF', 'BIRD', 'FISH'];

function shiftWord(w, k) {
    return w.split('').map((ch) => String.fromCharCode(((ch.charCodeAt(0) - 65 + k) % 26) + 65)).join('');
}

function buildCipher(ctx) {
    const word = pickOne(CIPHER_WORDS);
    const k = 2 + randInt(4);
    const encoded = shiftWord(word, k);
    const decoys = shuffle(CIPHER_WORDS.filter((w) => w !== word && w !== encoded)).slice(0, 3);
    return wrapQuiz('cipher', {
        ...ctx,
        title: '🔐 فعالية: اكسر الشفرة',
        question: `شُفرت كلمة بإزاحة كل حرف **+${k}** خطوات في الأبجدية (A → ${String.fromCharCode(65 + k)}).\n\nالكلمة المشفَّرة: \`${encoded}\`\n\nما **الكلمة الأصلية**؟`,
        correct: word,
        traps: decoys,
        record: { encoded, shift: k, answer: word }
    });
}

// 15) التناظر اللفظي
const ANALOGY_BANK = [
    { q: 'الحذاء : القدم :: القفاز : ؟', a: 'اليد', opts: ['اليد', 'الرأس', 'القدم', 'الجسم'] },
    { q: 'الشمس : النهار :: القمر : ؟', a: 'الليل', opts: ['الليل', 'النجوم', 'الغروب', 'الشهر'] },
    { q: 'الطبيب : المستشفى :: المعلم : ؟', a: 'المدرسة', opts: ['المدرسة', 'المنزل', 'المتجر', 'الملعب'] },
    { q: 'القلم : كتابة :: المقص : ؟', a: 'قص', opts: ['قص', 'رسم', 'قياس', 'محاكاة'] },
    { q: 'النار : ساخن :: الثلج : ؟', a: 'بارد', opts: ['بارد', 'رطب', 'ثقيل', 'أبيض'] },
    { q: 'الطائر : عش :: الإنسان : ؟', a: 'بيت', opts: ['بيت', 'شارع', 'سيارة', 'مدينة'] },
    { q: 'الماء : عطش :: الطعام : ؟', a: 'جوع', opts: ['جوع', 'تعب', 'نوم', 'مرض'] },
    { q: 'الساعة : الوقت :: الميزان : ؟', a: 'الوزن', opts: ['الوزن', 'الطول', 'الحرارة', 'السرعة'] },
    { q: 'الخروف : صوف :: الدجاجة : ؟', a: 'بيض', opts: ['بيض', 'لبن', 'ريش', 'عسل'] },
    { q: 'الكتاب : قراءة :: الطعام : ؟', a: 'أكل', opts: ['أكل', 'طبخ', 'شراء', 'حفظ'] }
];

function buildAnalogy(ctx) {
    const p = pickOne(ANALOGY_BANK);
    return wrapQuiz('analogy', {
        ...ctx,
        title: '🔗 فعالية: التناظر اللفظي',
        question: `أكمل التناظر بنفس العلاقة:\n\n**${p.q}**`,
        correct: p.a,
        traps: p.opts.filter((x) => x !== p.a),
        record: { answer: p.a }
    });
}

// 16) الاتجاهات: تصور فراغي
const DIRECTION_BANK = [
    {
        q: 'مشيت **5 خطوات شمال**، ثم **3 خطوات شرق**، ثم **5 خطوات جنوب**. أين أنت بالنسبة لنقطة البداية؟',
        a: '3 خطوات شرق', opts: ['3 خطوات شرق', '3 خطوات غرب', '10 خطوات شمال', 'في نقطة البداية']
    },
    {
        q: 'تواجه **الشمال**، ثم تلتفت إلى يمينك مرتين. بأي اتجاه تواجه الآن؟',
        a: 'الجنوب', opts: ['الشمال', 'الشرق', 'الجنوب', 'الغرب']
    },
    {
        q: 'مشيت 4 خطوات شرق، ثم 4 شمال، ثم 4 غرب، ثم 4 جنوب. أين أنت؟',
        a: 'في نقطة البداية', opts: ['في نقطة البداية', '4 خطوات شمال', '4 خطوات شرق', '8 خطوات شمال']
    },
    {
        q: 'كنت أواجه **الشرق** والتفت إلى يسارك مرتين، ثم مشيت 3 خطوات للأمام. في أي اتجاه تحركت؟',
        a: 'الغرب', opts: ['الشرق', 'الغرب', 'الشمال', 'الجنوب']
    },
    {
        q: 'مشيت 10 خطوات شمال، ثم 6 خطوات جنوب. كم خطوة تفصلك عن البداية وفي أي اتجاه؟',
        a: '4 خطوات شمال', opts: ['4 خطوات شمال', '4 خطوات جنوب', '16 خطوة شمال', '16 خطوة جنوب']
    },
    {
        q: 'كنت أواجه **الجنوب**، التفت يمينًا، ثم التفت يمينًا، ثم التفت يسارًا. بأي اتجاه تواجه الآن؟',
        a: 'الغرب', opts: ['الشرق', 'الغرب', 'الشمال', 'الجنوب']
    },
    {
        q: 'مشيت 3 خطوات شمال ثم 3 خطوات غرب. كم يبعد موقعك عن نقطة البداية (خط مستقيم)؟',
        a: 'حوالي 4.2 خطوة', opts: ['6 خطوات', 'حوالي 4.2 خطوة', '3 خطوات', 'حوالي 5 خطوات']
    }
];

function buildDirection(ctx) {
    const p = pickOne(DIRECTION_BANK);
    return wrapQuiz('direction', {
        ...ctx,
        title: '🧭 فعالية: الاتجاهات',
        question: `**${p.q}**\n\nتخيّل المشهد قبل ما تختار.`,
        correct: p.a,
        traps: p.opts.filter((x) => x !== p.a),
        record: { answer: p.a }
    });
}

// 17) مسألة كلامية: خطوة أو أكثر
const WORD_PROBLEM_BANK = [
    { q: 'عند أحمد **3 أضعاف** ما عند سعد. إذا كان مجموع ما عندهما **60**، فكم عند سعد؟', a: '15', opts: ['15', '20', '30', '45'] },
    { q: 'قطار مشى بسرعة **60 كم/ساعة** لمدة ساعتين، ثم **80 كم/ساعة** لمدة ساعة. كم مشى إجمالًا؟', a: '200 كم', opts: ['140 كم', '200 كم', '220 كم', '240 كم'] },
    { q: 'سعر قميص **200 ريال** وعليه خصم **25%**. كم يدفع في النهاية؟', a: '150 ريال', opts: ['150 ريال', '175 ريال', '125 ريال', '160 ريال'] },
    { q: 'عمر الأب **3 أضعاف** عمر ابنه، ومجموع عمرهما **48 سنة**. كم عمر الابن؟', a: '12', opts: ['12', '16', '24', '36'] },
    { q: 'إذا كانت **5 قطع** تكلف **30 ريالًا**، فكم تكلفة **8 قطع** بنفس السعر؟', a: '48 ريال', opts: ['40 ريال', '48 ريال', '54 ريال', '60 ريال'] },
    { q: 'خزانة تمتلئ بالماء في **6 ساعات** بواسطة **3 صنابير**. كم صنبورًا نحتاج لتمتلئ في **ساعتين**؟', a: '9', opts: ['6', '9', '12', '18'] },
    { q: 'إذا كان سعر **4 أقلام و3 دفاتر = 26 ريالًا**، وسعر **4 أقلام ودفتر = 14 ريالًا**، فكم سعر الدفتر؟', a: '6 ريالات', opts: ['3 ريالات', '4 ريالات', '6 ريالات', '8 ريالات'] },
    { q: 'صندوق به **12 كرة**: 5 حمراء و4 زرقاء والباقي أخضر. ما احتمال سحب كرة خضراء؟', a: '3/12', opts: ['3/12', '5/12', '4/12', '1/12'] },
    { q: 'عداء ركض **12 كم** في **ساعتين**. ما متوسط سرعته؟', a: '6 كم/ساعة', opts: ['4 كم/ساعة', '6 كم/ساعة', '10 كم/ساعة', '24 كم/ساعة'] }
];

function buildWordProblem(ctx) {
    const p = pickOne(WORD_PROBLEM_BANK);
    return wrapQuiz('word_problem', {
        ...ctx,
        title: '🧮 فعالية: مسألة تحتاج خطوات',
        question: `**${p.q}**`,
        correct: p.a,
        traps: p.opts.filter((x) => x !== p.a),
        record: { answer: p.a }
    });
}

// 18) من يكذب؟ منطق الصادق والكاذب
const TRUTH_LIE_BANK = [
    {
        q: 'ثلاثة أشخاص، **واحد فقط يكذب دائمًا** والبقية يقولون الحقيقة:\n(أ) يقول: "(ب) يكذب".\n(ب) يقول: "(ج) يقول الحقيقة".\n(ج) يقول: "(أ) يكذب".\n\nمن الكاذب؟',
        a: 'أ', opts: ['أ', 'ب', 'ج', 'لا يمكن معرفته']
    },
    {
        q: 'شخص يقول عن نفسه: **"أنا أكذب دائمًا"**. هل يمكن أن يكون صادقًا؟',
        a: 'لا، هذا تناقض', opts: ['نعم', 'لا، هذا تناقض', 'فقط في بعض الأيام', 'المعلومة ناقصة']
    },
    {
        q: 'في جزيرة الصادقين والكاذبين، قابلت شخصًا وقال: **"نحن الاثنان صادقان"** بينما تعرف أن صديقه **كاذب**. ما نوع المتحدث؟',
        a: 'كاذب', opts: ['صادق', 'كاذب', 'لا يمكن معرفته', 'كلاهما صادق']
    },
    {
        q: 'ثلاثة صناديق، في واحد جائزة:\n(أ) يقول: "الجائزة في (ب)".\n(ب) يقول: "الجائزة ليست هنا".\n(ج) يقول: "الجائزة ليست في (أ)".\n\nإذا كانت **واحدة فقط** من العبارات صادقة، أين الجائزة؟',
        a: 'الصندوق (أ)', opts: ['الصندوق (أ)', 'الصندوق (ب)', 'الصندوق (ج)', 'لا يمكن معرفته']
    },
    {
        q: '(أ) يقول: "(ج) يكذب".\n(ب) يقول: "(أ) يقول الحقيقة".\n(ج) يقول: "(ب) يكذب".\n\nإذا كان **واحد فقط** يكذب دائمًا، فمن الكاذب؟',
        a: 'ج', opts: ['أ', 'ب', 'ج', 'لا يمكن معرفته']
    },
    {
        q: 'ثلاثة أشخاص، **واحد فقط يكذب دائمًا** والبقية يقولون الحقيقة:\n(أ) يقول: "(ب) يكذب".\n(ب) يقول: "(ج) يكذب".\n(ج) يقول: "(أ) يقول الحقيقة".\n\nمن الكاذب؟',
        a: 'ب', opts: ['أ', 'ب', 'ج', 'لا يمكن معرفته']
    }
];

function buildTruthLie(ctx) {
    const p = pickOne(TRUTH_LIE_BANK);
    return wrapQuiz('truth_lie', {
        ...ctx,
        title: '🕵️ فعالية: من يكذب؟',
        question: `**${p.q}**\n\nحلّل الافتراضات واحدة واحدة.`,
        correct: p.a,
        traps: p.opts.filter((x) => x !== p.a),
        record: { answer: p.a }
    });
}

// 19) أكمل المصفوفة
const MATRIX_BANK = [
    { grid: ['2   4   6', '3   6   9', '4   8   ?'], a: 12, t: [9, 10, 16] },
    { grid: ['2   4   6', '3   5   8', '4   6   ?'], a: 10, t: [8, 12, 14] },
    { grid: ['5   10  15', '6   12  18', '7   14  ?'], a: 21, t: [20, 22, 28] },
    { grid: ['2   3   4', '4   6   8', '6   9   ?'], a: 12, t: [10, 11, 15] },
    { grid: ['9   6   3', '8   5   2', '7   4   ?'], a: 1, t: [0, 2, 3] },
    { grid: ['1   4   9', '16  25  36', '49  64  ?'], a: 81, t: [72, 100, 49] },
    { grid: ['2   6   12', '3   9   18', '4   12  ?'], a: 24, t: [16, 20, 32] },
    { grid: ['10  8   6', '9   7   5', '8   6   ?'], a: 4, t: [2, 3, 5] }
];

function buildMatrix(ctx) {
    const p = pickOne(MATRIX_BANK);
    return wrapQuiz('matrix', {
        ...ctx,
        title: '▦ فعالية: أكمل المصفوفة',
        question: 'في قاعدة تحكم بالصفوف أو الأعمدة… اكتشفها وأكمل:\n\n```\n' + p.grid.join('\n') + '\n```',
        correct: p.a,
        traps: p.t
    });
}

// ===== الألعاب الخاصة (ضد البوت) =====

function xoWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    for (const [a, c, d] of lines) {
        const v = board[a];
        if (v && v === board[c] && v === board[d]) return v;
    }
    return null;
}

function xoIsFull(board) {
    for (let i = 0; i < 9; i++) if (!board[i]) return false;
    return true;
}

function xoEmpty(board) {
    const out = [];
    for (let i = 0; i < 9; i++) if (!board[i]) out.push(i);
    return out;
}

// ذكاء البوت: minimax (يلعب بذكاء مع نسبة أخطاء بسيطة عشان تكون قابلة للفوز)
function xoBestMove(board) {
    const empties = xoEmpty(board);
    if (!empties.length) return -1;
    if (Math.random() < 0.25) return empties[Math.floor(Math.random() * empties.length)];

    const minimax = (b, turn, depth) => {
        const w = xoWinner(b);
        if (w === 'O') return 10 - depth;
        if (w === 'X') return depth - 10;
        if (xoIsFull(b)) return 0;
        let best = turn === 'O' ? -Infinity : Infinity;
        for (const i of xoEmpty(b)) {
            b[i] = turn;
            const score = minimax(b, turn === 'O' ? 'X' : 'O', depth + 1);
            b[i] = null;
            best = turn === 'O' ? Math.max(best, score) : Math.min(best, score);
        }
        return best;
    };

    let bestScore = -Infinity;
    let bestMove = empties[0];
    for (const i of empties) {
        board[i] = 'O';
        const score = minimax(board, 'X', 0);
        board[i] = null;
        if (score > bestScore) {
            bestScore = score;
            bestMove = i;
        }
    }
    return bestMove;
}

function xoRenderComponents(board) {
    const rows = [];
    for (let r = 0; r < 3; r++) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < 3; c++) {
            const idx = r * 3 + c;
            const v = board[idx];
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`event:xo:${idx}`)
                    .setLabel(v === 'X' ? 'X' : v === 'O' ? 'O' : '·')
                    .setStyle(v ? ButtonStyle.Secondary : ButtonStyle.Primary)
                    .setDisabled(Boolean(v))
            );
        }
        rows.push(row);
    }
    return rows;
}

function buildXo(ctx) {
    return wrapSpecial('xo', {
        ...ctx,
        title: '❌⭕ فعالية: إكس أو ضد البوت',
        description: 'البوت **يلعب بذكاء** 🧠 — أول لاعب يضغط يبدأ بـ (X).\n\nإذا **فزت** تأخذ المكافأة، وإذا تعادلت أو خسرت تنتهي الفعالية.',
        components: xoRenderComponents(Array(9).fill(null)),
        record: { board: Array(9).fill(null), playerId: null }
    });
}

// نيم: لعبة استراتيجية (خذ 1-3 عصي من رزمة، اللي يأخذ آخر عصا يفوز)
// أفضل حركة للاعب: استراتيجية Grundy (كل رزمة n تقابلها قيمة n mod 4)
function nimBestMove(piles) {
    const grundy = piles.map((n) => n % 4);
    const x = grundy.reduce((s, g) => s ^ g, 0);
    for (let i = 0; i < piles.length; i++) {
        if (piles[i] <= 0) continue;
        const target = grundy[i] ^ x;
        if (target < grundy[i]) {
            const t = grundy[i] - target;
            if (t >= 1 && t <= 3 && t <= piles[i]) return { pile: i, take: t };
        }
    }
    return null;
}

function nimRandomMove(piles) {
    const legal = [];
    for (let i = 0; i < piles.length; i++) {
        for (let k = 1; k <= 3; k++) if (piles[i] >= k) legal.push({ pile: i, take: k });
    }
    return legal.length ? legal[Math.floor(Math.random() * legal.length)] : null;
}

function nimRenderComponents(piles) {
    const rows = [];
    for (let i = 0; i < piles.length; i++) {
        const row = new ActionRowBuilder();
        for (let k = 1; k <= 3; k++) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`event:nim:${i}:${k}`)
                    .setLabel(`من الرزمة ${i + 1}: خذ ${k}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(piles[i] < k)
            );
        }
        rows.push(row);
    }
    return rows;
}

function nimLines(piles) {
    return piles.map((n, i) => `**الرزمة ${i + 1}:** ${'▰'.repeat(n) || '—'} (${n})`).join('\n');
}

function buildNim(ctx) {
    const piles = [3 + randInt(4), 3 + randInt(4), 3 + randInt(4)]; // 3-6 لكل رزمة
    return wrapSpecial('nim', {
        ...ctx,
        title: '🎯 فعالية: نيم — ضد البوت',
        description: `كل دور تأخذ **1 إلى 3 عصي** من **رزمة واحدة** فقط. اللي يأخذ **آخر عصا يفوز** 🏆\n\nالبوت يلعب بذكاء… فكّر في خطوتك!\n\n${nimLines(piles)}`,
        components: nimRenderComponents(piles),
        record: { piles, playerId: null }
    });
}

// ---------- مساعدات للألعاب الخارجية (/trivia) ومضاعفات المكافآت ----------

// مجموع أسئلة التحدي الفردي — خليط من كل بنوك الأسئلة الصعبة
function getTriviaPool() {
    const pool = [];
    const add = (q, correct, opts) => pool.push({
        q: String(q),
        correct: String(correct),
        opts: shuffle([String(correct), ...opts.filter((x) => String(x) !== String(correct)).map(String)])
    });

    for (const t of TRIVIA_HARD) add(t.q, t.a, t.opts);
    for (const t of TRIVIA_EN) add(t.q, t.a, t.opts);
    for (const r of RIDDLE_BANK) add(r.q, r.a, r.opts);
    for (const s of SEQUENCE_BANK) add(`أكمل التسلسل: \`${s.s.join(' - ')} - ؟\``, s.a, s.t);
    for (const a of ANALOGY_BANK) add(`أكمل التناظر: **${a.q}**`, a.a, a.opts);
    for (const l of LOGIC_ORDER_BANK) add(l.q, l.a, l.opts);
    for (const w of WORD_PROBLEM_BANK) add(w.q, w.a, w.opts);
    for (const m of MATRIX_BANK) add(`أكمل المصفوفة:\n\`\`\`\n${m.grid.join('\n')}\n\`\`\``, m.a, m.t);
    return pool;
}

// ألعاب أصعب = مكافأة أكبر
const REWARD_MULTIPLIERS = {
    xo: 1.5,
    nim: 1.5,
    truth_lie: 1.25,
    cipher: 1.25,
    matrix: 1.25,
    math_algebra: 1.25,
    logic_order: 1.25,
    word_problem: 1.25,
    direction: 1.25,
    number_sequence: 1.25,
    emoji_meaning: 1.25
};

function rewardMultiplierFor(type) {
    return REWARD_MULTIPLIERS[type] || 1;
}

// ---------- السجل ----------
const GAMES = {
    math_quick: { label: 'حساب متسلسل', build: buildMathQuick },
    math_algebra: { label: 'احسب (س)', build: buildMathAlgebra },
    number_sequence: { label: 'التسلسل', build: buildNumberSequence },
    logic_order: { label: 'منطق وترتيب', build: buildLogicOrder },
    truth_lie: { label: 'من يكذب؟', build: buildTruthLie },
    cipher: { label: 'اكسر الشفرة', build: buildCipher },
    analogy: { label: 'التناظر اللفظي', build: buildAnalogy },
    direction: { label: 'الاتجاهات', build: buildDirection },
    word_problem: { label: 'مسألة كلامية', build: buildWordProblem },
    matrix: { label: 'أكمل المصفوفة', build: buildMatrix },
    odd_one_out: { label: 'المختلف', build: buildOddOneOut },
    find_imposter: { label: 'اكشف المجرم', build: buildFindImposter },
    trivia_quiz: { label: 'معلومات عامة', build: buildTriviaQuiz },
    trivia_en: { label: 'English Challenge', build: buildTriviaEn },
    word_scramble: { label: 'فك الشفرة', build: buildWordScramble },
    riddle_me: { label: 'لغز', build: buildRiddleMe },
    letter_word: { label: 'الكلمة المخفية', build: buildLetterWord },
    emoji_meaning: { label: 'معادلات الإيموجي', build: buildEmojiEquations },
    category_clash: { label: 'التقاطع', build: buildCategoryClash },
    xo: { label: 'إكس أو ضد البوت', build: buildXo, multi: true },
    nim: { label: 'نيم ضد البوت', build: buildNim, multi: true }
};

const GAME_KEYS = Object.keys(GAMES);

// الحد الأدنى للفعالية: الألعاب الذكية تحتاج وقت
function minDurationMsFor(type) {
    return GAMES[type] && GAMES[type].multi ? 120_000 : 45_000;
}

// الأنواع المفعّلة (المفتاح الغائب = مفعّل افتراضيًا)
function enabledTypes(typesEnabled) {
    const t = typesEnabled && typeof typesEnabled === 'object' ? typesEnabled : {};
    return GAME_KEYS.filter((k) => t[k] !== false);
}

function buildEvent(type, ctx) {
    const game = GAMES[type];
    if (!game || typeof game.build !== 'function') return null;
    return game.build(ctx);
}

module.exports = {
    GAMES,
    GAME_KEYS,
    enabledTypes,
    buildEvent,
    minDurationMsFor,
    getTriviaPool,
    rewardMultiplierFor,
    REWARD_MULTIPLIERS,
    xoWinner,
    xoIsFull,
    xoRenderComponents,
    xoBestMove,
    nimRenderComponents,
    nimLines,
    nimBestMove,
    nimRandomMove
};
