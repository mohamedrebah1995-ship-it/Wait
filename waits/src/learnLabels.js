// Just the card labels for the profile row. Kept apart from learn.js on purpose: importing the
// full LEARN content into App.jsx would drag ten languages of prose into the first-paint bundle
// and defeat the lazy load. `rtl` lives here too so LearnScreen needs nothing from App.jsx.
export const LEARN_LABELS = {
  en: { title:"LEARN",     subtitle:"Multi-app driving — how to earn more per hour" },
  pl: { title:"NAUKA",     subtitle:"Praca na kilku aplikacjach — jak zarabiać więcej na godzinę" },
  ar: { title:"تعلّم",      subtitle:"العمل على عدة تطبيقات — كيف تربح أكثر في الساعة", rtl:true },
  hi: { title:"सीखें",       subtitle:"मल्टी-ऐप ड्राइविंग — प्रति घंटा ज़्यादा कमाई" },
  ur: { title:"سیکھیں",     subtitle:"ملٹی ایپ ڈرائیونگ — فی گھنٹہ زیادہ کمائیں", rtl:true },
  pt: { title:"APRENDER",  subtitle:"Trabalhar com várias apps — ganhar mais por hora" },
  zh: { title:"学习",       subtitle:"多平台跑单 — 如何提高时薪" },
  ro: { title:"ÎNVAȚĂ",    subtitle:"Lucrul pe mai multe aplicații — cum câștigi mai mult pe oră" },
  es: { title:"APRENDE",   subtitle:"Trabajar con varias apps — cómo ganar más por hora" },
  ru: { title:"ОБУЧЕНИЕ",  subtitle:"Работа в нескольких приложениях — как зарабатывать больше в час" },
};
