const shopItems = [
  { id: 'rank1', name: 'رتبة قارئ الفجر', price: 50, description: 'لقب شرفي يعبر عن النشاط اليومي.' },
  { id: 'rank2', name: 'لقب حافظ النية', price: 100, description: 'لقب يدل على الإخلاص في القراءة.' },
  { id: 'rank3', name: 'نعمة التلاوة', price: 200, description: 'قدرة رمزية تزيد من حماسك للذكر.' },
  { id: 'rank4', name: 'شهادة المثابرة', price: 300, description: 'وسام خاص للذي يثابر دائما.' },
];

const questionBank = [
  {
    id: 'q1',
    question: 'كم ركعة صلاة الفجر؟',
    choices: ['2', '3', '4', '1'],
    answer: '2',
  },
  {
    id: 'q2',
    question: 'ما عدد سور القرآن الكريم؟',
    choices: ['114', '99', '120', '100'],
    answer: '114',
  },
  {
    id: 'q3',
    question: 'ما هو اسم المدينة التي هاجر إليها النبي ﷺ؟',
    choices: ['المدينة المنورة', 'مكة', 'الطائف', 'بدر'],
    answer: 'المدينة المنورة',
  },
  {
    id: 'q4',
    question: 'كم عدد أشهر الحج؟',
    choices: ['3', '4', '2', '1'],
    answer: '4',
  },
];

module.exports = { shopItems, questionBank };
