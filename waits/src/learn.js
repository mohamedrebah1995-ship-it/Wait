// ── LEARNING MATERIALS ────────────────────────────────────────────────────────
// Driver training content: how to multi-app across Uber Eats / Deliveroo / Just Eat and protect
// your £/hour. Kept in its own module and lazy-loaded from the profile, so ten languages of prose
// never land in the first-paint bundle.
//
// Shape per language: { title, subtitle, sections: [{ h, p?, ul?, note? }] }
//   h    = section heading
//   p    = paragraphs
//   ul   = bullet list
//   note = the one line worth remembering, pulled out as a callout
//
// Translations are machine-produced from the English source and are worth a native-speaker read
// before this is leaned on as training material.

const EN = {
  title: "LEARN",
  subtitle: "Multi-app driving — how to earn more per hour",
  sections: [
    { h: "1. What multi-apping actually is",
      p: ["Working more than one delivery platform at the same time — Uber Eats, Deliveroo and Just Eat."],
      note: "The goal is not the most orders. It is the most money per hour, with distance, waiting and risk under control." },

    { h: "2. Every order has five values",
      ul: ["Pay — what it pays", "Distance — how far you drive", "Time — how long it really takes", "Direction — where it leaves you", "Waiting risk — how likely the kitchen is to delay you"],
      p: ["The highest-paying order is not automatically the best one.", "£8 / 2 miles / 20 min beats £10 / 6 miles / 40 min: more money for your time, and you stay near the busy area."] },

    { h: "3. Protect your time above all",
      p: ["Your biggest cost is not fuel. It is dead time: driving to food that isn't ready, waiting at the counter, driving back to a busy area, and sitting idle."],
      p2: ["£30 in one hour is £30/hour. The same £30 in an hour and a half is £20/hour."],
      note: "The same money is a good shift or a bad shift depending only on the clock." },

    { h: "4. Reading restaurant wait times",
      p: ["Waiting time is the single biggest difference between a profitable and an unprofitable shift."],
      ul: ["Green — short, predictable wait. Good for stacking.", "Orange — moderate wait. Accept carefully.", "Red — long or unpredictable. Usually do not stack around it."],
      p2: ["In this app: green is under 45 minutes to complete, orange 45–60, red over an hour."] },

    { h: "5. Stacking orders",
      p: ["A stack is two orders that genuinely fit into one trip."],
      note: "Ask: can I do both without badly delaying the first customer? Not: two orders equals double money.",
      p2: ["The real question is how much extra money you get for the extra time and distance."] },

    { h: "6. A good stack",
      ul: ["£7 Uber order and a £6 Deliveroo order", "Both restaurants close together", "Both drop-offs in the same direction", "Both kitchens normally fast"],
      p: ["£13 total. If the second order adds only 10–15 minutes, that is an excellent stack."] },

    { h: "7. A bad stack",
      ul: ["You already have an £8 order", "The new one pays £6", "Its restaurant is 3 miles the opposite way", "That kitchen has a history of long waits"],
      p: ["The £6 can destroy the value of the £8. The right call is usually to reject it."] },

    { h: "8. Direction beats distance",
      p: ["Three miles in the right direction can beat one mile in the wrong one."],
      p2: ["You are heading north. Order A is 3 miles north for £7. Order B is 1 mile south for £6. Order A is often better, because after B you drive back empty — and empty miles are unpaid time."] },

    { h: "9. The hidden cost of leaving your zone",
      p: ["£10 for 5 miles looks good. But you finish 5 miles from the restaurants that feed you, then drive 4 miles back with nothing."],
      note: "Real movement: 9 miles. Always ask where an order leaves you, not just where it takes you." },

    { h: "10. Demand is not the same on every app",
      p: ["Platform strength moves around. Patterns worth watching for in your own area:"],
      ul: ["Uber often strong on Sundays", "Just Eat often strong on Saturdays", "Evenings and nights usually denser", "Roughly 4pm–6pm a key build-up period"],
      p2: ["Best platform changes with day, time, area, restaurant, weather, demand and how many drivers are out. Do not treat all apps as equal."] },

    { h: "11. The 'one good order' trap",
      p: ["A £12 order looks excellent. Then: 10 minutes to the restaurant, 20 waiting, 30 driving, 10 getting back to the busy zone. That is 70 minutes — under £10/hour."],
      note: "Always judge an order as: pay ÷ realistic total time." },

    { h: "12. What good looks like",
      p: ["One recorded shift: £134.69 over 5 hours across 16 orders — £26.94/hour."],
      p2: ["Longer-run benchmarks: £25–£30/hour typical, £35–£40/hour on strong weekend periods, around £1,338 across roughly 45–50 hours."],
      note: "Multi-apping works when the platforms fill each other's gaps instead of competing for your time." },

    { h: "13. Seven checks before you accept",
      ul: ["Pay — is it worth the time?", "Distance — how many miles?", "Direction — does it keep you productive?", "Restaurant — fast or slow kitchen?", "Current order — will this interfere?", "Return — where do you finish?", "Hourly value — total pay ÷ total time"],
      p: ["If the new order damages the whole route, reject it."] },

    { h: "14. Worked example — accept",
      p: ["You hold a £8 Deliveroo order, food in 5 minutes, dropping north. A £7 Uber order appears: restaurant 500 m away, also dropping north."],
      ul: ["Same direction", "Tiny extra distance", "Both collectable quickly", "Meaningful extra money"],
      note: "Strong stack. Take it." },

    { h: "15. Worked example — reject",
      p: ["You hold a £9 Just Eat order, food almost ready, dropping east. A £6 Uber order appears: restaurant 2 miles west, slow kitchen, customer further west."],
      ul: ["Extra driving", "Extra waiting", "Wrong direction", "Puts the £9 order at risk"],
      note: "Reject it." },

    { h: "16. Restaurant knowledge is an asset",
      p: ["After enough deliveries you carry your own database: which kitchens are fast, which are slow, which turn slow at certain hours, which prepare early, which are worth stacking around."],
      note: "That knowledge is often worth more than the payout on the screen." },

    { h: "17. Turn memory into data",
      p: ["Memory fades and flatters. Log the restaurant, time, wait in minutes, platform, day and whether it was busy — then the pattern shows itself."],
      p2: ["A kitchen that is green at 3pm can be red at 7pm. That is exactly what the wait times in this app are for."] },

    { h: "18. How this app helps",
      p: ["Stack Check exists to answer one question: can I add this order without wrecking the route I already have?"],
      p2: ["CHECK → ADD ORDER → DRIVE. It combines route, distance, timing, restaurant wait and the orders you already hold."],
      note: "It does not decide for you. It puts the important facts in front of you fast." },

    { h: "19. Seven common mistakes",
      ul: ["Chasing the payout — £15 is not automatically good", "Ignoring the kitchen — £7 with a 30-minute wait is bad money", "Ignoring direction — a short order can strand you", "Over-stacking — more orders can mean slower deliveries and less per hour", "Counting only miles — time and waiting often matter more", "Forgetting the return — finishing far from demand costs unpaid miles", "Sunk-cost thinking — an accepted order must not force a bad second decision"] },

    { h: "20. The core formula",
      p: ["True order value = pay − time cost − extra distance − waiting risk."],
      p2: ["Stack value = extra pay − extra time − extra distance − delay risk."],
      note: "You do not need perfect maths. You need consistent decisions." },

    { h: "21. Fast cheat sheet",
      ul: ["GREEN — good pay, short wait, same direction, little extra distance, good finish position. Usually accept.", "ORANGE — fair pay, moderate wait, some detour, possible delay. Work it out first.", "RED — long wait, wrong direction, big detour, poor finish, risks your current order. Usually reject."] },

    { h: "22. The real objective",
      p: ["Not the most deliveries. The highest sustainable £/hour with risk under control."],
      p2: ["A driver doing 25 badly-chosen orders can earn less than one doing 18 well-placed ones. Think in routes, time, demand and opportunity cost — not single orders."],
      note: "A good order improves the whole shift, not just the next ten minutes." },
  ],
};

// Non-English versions carry the same section order and the same teaching points.
const PL = { title:"NAUKA", subtitle:"Praca na kilku aplikacjach — jak zarabiać więcej na godzinę", sections:[
  {h:"1. Czym jest multi-apping", p:["Praca na kilku platformach jednocześnie — Uber Eats, Deliveroo i Just Eat."], note:"Celem nie jest najwięcej zamówień, tylko najwięcej pieniędzy na godzinę, przy kontroli dystansu, czekania i ryzyka."},
  {h:"2. Każde zamówienie ma pięć wartości", ul:["Stawka","Dystans","Czas — ile naprawdę zajmie","Kierunek — gdzie Cię zostawi","Ryzyko czekania"], p:["Najlepiej płatne zamówienie nie jest automatycznie najlepsze.","£8 / 2 mile / 20 min bije £10 / 6 mil / 40 min."]},
  {h:"3. Chroń swój czas", p:["Największym kosztem nie jest paliwo, tylko martwy czas: dojazd po niegotowe jedzenie, czekanie, powrót do ruchliwej strefy, przestoje."], p2:["£30 w godzinę to £30/h. To samo £30 w półtorej godziny to £20/h."], note:"Te same pieniądze to dobra albo zła zmiana — decyduje zegar."},
  {h:"4. Czytanie czasu oczekiwania", p:["Czas oczekiwania to największa różnica między zyskowną a niezyskowną zmianą."], ul:["Zielony — krótkie, przewidywalne. Dobre do łączenia.","Pomarańczowy — średnie. Ostrożnie.","Czerwony — długie lub nieprzewidywalne. Zwykle nie łącz."], p2:["W aplikacji: zielony poniżej 45 minut, pomarańczowy 45–60, czerwony powyżej godziny."]},
  {h:"5. Łączenie zamówień", p:["Stack to dwa zamówienia, które naprawdę mieszczą się w jednej trasie."], note:"Pytaj: czy zrobię oba bez dużego opóźnienia pierwszego klienta? Nie: dwa zamówienia to podwójne pieniądze."},
  {h:"6. Dobry stack", ul:["£7 Uber i £6 Deliveroo","Restauracje blisko siebie","Dostawy w tym samym kierunku","Obie kuchnie zwykle szybkie"], p:["Razem £13. Jeśli drugie dokłada tylko 10–15 minut, to świetny stack."]},
  {h:"7. Zły stack", ul:["Masz już £8","Nowe płaci £6","Restauracja 3 mile w przeciwną stronę","Kuchnia znana z długiego czekania"], p:["£6 może zniszczyć wartość £8. Zwykle należy odrzucić."]},
  {h:"8. Kierunek ważniejszy niż dystans", p:["Trzy mile w dobrym kierunku biją jedną milę w złym."], p2:["Jedziesz na północ. A: 3 mile na północ za £7. B: 1 milę na południe za £6. A bywa lepsze — po B wracasz pusty, a puste mile to czas bez zapłaty."]},
  {h:"9. Ukryty koszt wyjazdu ze strefy", p:["£10 za 5 mil wygląda dobrze. Ale kończysz 5 mil od restauracji i wracasz 4 mile bez zamówienia."], note:"Realny ruch: 9 mil. Pytaj, gdzie zamówienie Cię zostawi."},
  {h:"10. Popyt nie jest równy na każdej apce", p:["Siła platformy się zmienia. Wzorce warte obserwacji:"], ul:["Uber często mocny w niedziele","Just Eat często mocny w soboty","Wieczory i noce gęstsze","Około 16:00–18:00 kluczowy okres"], p2:["Najlepsza platforma zależy od dnia, godziny, okolicy, restauracji, pogody, popytu i liczby kierowców."]},
  {h:"11. Pułapka „jednego dobrego zamówienia”", p:["£12 wygląda świetnie. Potem: 10 min dojazdu, 20 czekania, 30 jazdy, 10 powrotu. To 70 minut — poniżej £10/h."], note:"Oceniaj: stawka ÷ realny całkowity czas."},
  {h:"12. Jak wygląda dobry wynik", p:["Zapisana zmiana: £134,69 w 5 godzin, 16 zamówień — £26,94/h."], p2:["Dłuższe wyniki: £25–£30/h typowo, £35–£40/h w mocne weekendy, około £1338 przez 45–50 godzin."], note:"Multi-apping działa, gdy platformy wypełniają swoje luki, zamiast konkurować o Twój czas."},
  {h:"13. Siedem sprawdzeń przed akceptacją", ul:["Stawka — warta czasu?","Dystans — ile mil?","Kierunek — czy trzyma Cię w dobrym miejscu?","Restauracja — szybka czy wolna?","Obecne zamówienie — czy przeszkodzi?","Powrót — gdzie kończysz?","Wartość godzinowa — suma ÷ czas"], p:["Jeśli nowe zamówienie psuje całą trasę — odrzuć."]},
  {h:"14. Przykład — przyjmij", p:["Masz £8 Deliveroo, jedzenie za 5 minut, dostawa na północ. Pojawia się £7 Uber: restauracja 500 m, też na północ."], ul:["Ten sam kierunek","Minimalny dodatkowy dystans","Oba szybko do odbioru","Realny dodatkowy zarobek"], note:"Mocny stack. Bierz."},
  {h:"15. Przykład — odrzuć", p:["Masz £9 Just Eat, jedzenie prawie gotowe, dostawa na wschód. Pojawia się £6 Uber: restauracja 2 mile na zachód, wolna kuchnia, klient dalej na zachód."], ul:["Dodatkowa jazda","Dodatkowe czekanie","Zły kierunek","Ryzyko dla £9"], note:"Odrzuć."},
  {h:"16. Wiedza o restauracjach to majątek", p:["Po wielu dostawach masz własną bazę: które kuchnie są szybkie, które wolne, które zwalniają o pewnych godzinach, które przygotowują wcześniej."], note:"Ta wiedza bywa warta więcej niż stawka na ekranie."},
  {h:"17. Zamień pamięć w dane", p:["Pamięć zawodzi. Zapisuj restaurację, godzinę, minuty czekania, platformę, dzień i czy był ruch — wzorzec sam się pokaże."], p2:["Kuchnia zielona o 15:00 może być czerwona o 19:00."]},
  {h:"18. Jak pomaga ta aplikacja", p:["Stack Check odpowiada na jedno pytanie: czy mogę dodać to zamówienie bez zniszczenia obecnej trasy?"], p2:["CHECK → DODAJ ZAMÓWIENIE → JEDŹ. Łączy trasę, dystans, czas, czekanie i zamówienia, które już masz."], note:"Nie decyduje za Ciebie — szybko pokazuje najważniejsze fakty."},
  {h:"19. Siedem częstych błędów", ul:["Gonienie stawki — £15 to nie zawsze dobrze","Ignorowanie kuchni — £7 z 30-minutowym czekaniem to zły pieniądz","Ignorowanie kierunku","Zbyt wiele stacków","Liczenie tylko mil","Zapominanie o powrocie","Myślenie kosztem utopionym"]},
  {h:"20. Kluczowy wzór", p:["Wartość zamówienia = stawka − koszt czasu − dodatkowy dystans − ryzyko czekania."], p2:["Wartość stacku = dodatkowa stawka − dodatkowy czas − dodatkowy dystans − ryzyko opóźnienia."], note:"Nie potrzebujesz idealnej matematyki. Potrzebujesz spójnych decyzji."},
  {h:"21. Szybka ściąga", ul:["ZIELONE — dobra stawka, krótkie czekanie, ten sam kierunek, mały objazd. Zwykle bierz.","POMARAŃCZOWE — średnio. Policz najpierw.","CZERWONE — długie czekanie, zły kierunek, duży objazd, ryzyko dla obecnego zamówienia. Zwykle odrzuć."]},
  {h:"22. Prawdziwy cel", p:["Nie najwięcej dostaw, tylko najwyższe stabilne £/h przy kontrolowanym ryzyku."], p2:["Kierowca z 25 źle dobranymi zamówieniami może zarobić mniej niż ten z 18 dobrze ustawionymi."], note:"Dobre zamówienie poprawia całą zmianę, nie tylko najbliższe dziesięć minut."},
]};

const AR = { title:"تعلّم", subtitle:"العمل على عدة تطبيقات — كيف تربح أكثر في الساعة", sections:[
  {h:"١. ما هو العمل على عدة تطبيقات", p:["العمل على أكثر من منصة في الوقت نفسه — أوبر إيتس، ديليفرو، وجست إيت."], note:"الهدف ليس أكبر عدد من الطلبات، بل أكبر دخل في الساعة مع التحكم في المسافة والانتظار والمخاطرة."},
  {h:"٢. لكل طلب خمس قيم", ul:["الأجر","المسافة","الوقت الحقيقي","الاتجاه — أين سيتركك","خطر الانتظار"], p:["الطلب الأعلى أجراً ليس بالضرورة الأفضل.","٨£ / ميلين / ٢٠ دقيقة أفضل من ١٠£ / ٦ أميال / ٤٠ دقيقة."]},
  {h:"٣. احمِ وقتك", p:["أكبر تكلفة ليست الوقود بل الوقت الميت: الذهاب لطعام غير جاهز، الانتظار، العودة للمنطقة النشطة، والجلوس بلا عمل."], p2:["٣٠£ في ساعة تساوي ٣٠£/ساعة. نفس المبلغ في ساعة ونصف يساوي ٢٠£/ساعة."], note:"نفس المال يكون وردية جيدة أو سيئة حسب الساعة فقط."},
  {h:"٤. قراءة وقت انتظار المطاعم", p:["وقت الانتظار هو أكبر فارق بين وردية مربحة وأخرى خاسرة."], ul:["أخضر — انتظار قصير ومتوقع. مناسب للدمج.","برتقالي — متوسط. اقبل بحذر.","أحمر — طويل أو غير متوقع. تجنّب الدمج."], p2:["في التطبيق: أخضر أقل من ٤٥ دقيقة، برتقالي ٤٥–٦٠، أحمر أكثر من ساعة."]},
  {h:"٥. دمج الطلبات", p:["الدمج هو طلبان يتناسبان فعلاً ضمن رحلة واحدة."], note:"اسأل: هل أنجزهما دون تأخير كبير للزبون الأول؟ وليس: طلبان يعني ضعف المال."},
  {h:"٦. دمج جيد", ul:["طلب أوبر ٧£ وطلب ديليفرو ٦£","المطعمان متقاربان","التسليم في نفس الاتجاه","المطبخان سريعان عادةً"], p:["المجموع ١٣£. إذا أضاف الثاني ١٠–١٥ دقيقة فقط فهو دمج ممتاز."]},
  {h:"٧. دمج سيّئ", ul:["لديك طلب بـ ٨£","الجديد بـ ٦£","مطعمه على بعد ٣ أميال بالاتجاه المعاكس","مطبخ معروف بالانتظار الطويل"], p:["الـ ٦£ قد تدمّر قيمة الـ ٨£. الأصح غالباً رفضه."]},
  {h:"٨. الاتجاه أهم من المسافة", p:["ثلاثة أميال بالاتجاه الصحيح أفضل من ميل بالاتجاه الخاطئ."], p2:["أنت متجه شمالاً. أ: ٣ أميال شمالاً بـ ٧£. ب: ميل جنوباً بـ ٦£. غالباً أ أفضل، لأنك بعد ب تعود فارغاً — والأميال الفارغة وقت بلا أجر."]},
  {h:"٩. التكلفة الخفية للخروج من منطقتك", p:["١٠£ مقابل ٥ أميال تبدو جيدة. لكنك تنتهي على بعد ٥ أميال من المطاعم ثم تعود ٤ أميال بلا طلب."], note:"الحركة الحقيقية: ٩ أميال. اسأل دائماً أين سيتركك الطلب."},
  {h:"١٠. الطلب ليس متساوياً بين التطبيقات", p:["قوة المنصة تتغيّر. أنماط تستحق الملاحظة:"], ul:["أوبر قوي غالباً أيام الأحد","جست إيت قوي غالباً أيام السبت","المساء والليل أكثف","تقريباً ٤–٦ مساءً فترة مهمة"], p2:["الأفضل يتغيّر حسب اليوم والوقت والمنطقة والمطعم والطقس والطلب وعدد السائقين."]},
  {h:"١١. فخ «الطلب الجيد الواحد»", p:["١٢£ تبدو ممتازة. ثم: ١٠ دقائق للمطعم، ٢٠ انتظاراً، ٣٠ قيادة، ١٠ للعودة. المجموع ٧٠ دقيقة — أقل من ١٠£/ساعة."], note:"احكم دائماً: الأجر ÷ الوقت الكلي الواقعي."},
  {h:"١٢. كيف يبدو الأداء الجيد", p:["وردية مسجّلة: ١٣٤٫٦٩£ في ٥ ساعات عبر ١٦ طلباً — ٢٦٫٩٤£/ساعة."], p2:["مؤشرات أطول: ٢٥–٣٠£/ساعة عادةً، ٣٥–٤٠£ في عطل نهاية الأسبوع القوية، نحو ١٣٣٨£ خلال ٤٥–٥٠ ساعة."], note:"الدمج ينجح حين تسدّ المنصات فجوات بعضها بدل التنافس على وقتك."},
  {h:"١٣. سبع فحوصات قبل القبول", ul:["الأجر — يستحق الوقت؟","المسافة — كم ميلاً؟","الاتجاه — يبقيك منتجاً؟","المطعم — سريع أم بطيء؟","طلبك الحالي — هل سيتعارض؟","العودة — أين تنتهي؟","القيمة بالساعة — المجموع ÷ الوقت"], p:["إذا أفسد الطلب الجديد المسار كله — ارفضه."]},
  {h:"١٤. مثال — اقبل", p:["لديك طلب ديليفرو ٨£، الطعام خلال ٥ دقائق، التسليم شمالاً. يظهر طلب أوبر ٧£: المطعم على بعد ٥٠٠ متر، والتسليم شمالاً أيضاً."], ul:["نفس الاتجاه","مسافة إضافية ضئيلة","كلاهما سريع الاستلام","دخل إضافي حقيقي"], note:"دمج قوي. خذه."},
  {h:"١٥. مثال — ارفض", p:["لديك طلب جست إيت ٩£، الطعام شبه جاهز، التسليم شرقاً. يظهر طلب أوبر ٦£: المطعم ميلان غرباً، مطبخ بطيء، والزبون أبعد غرباً."], ul:["قيادة إضافية","انتظار إضافي","اتجاه خاطئ","خطر على طلب الـ ٩£"], note:"ارفضه."},
  {h:"١٦. معرفة المطاعم رأس مال", p:["بعد توصيلات كافية تصبح لديك قاعدة بياناتك: أي المطابخ سريع، وأيها بطيء، وأيها يبطؤ في ساعات معيّنة."], note:"هذه المعرفة تساوي أحياناً أكثر من الأجر المعروض."},
  {h:"١٧. حوّل الذاكرة إلى بيانات", p:["الذاكرة تخون. سجّل المطعم والوقت ودقائق الانتظار والمنصة واليوم وهل كان الوقت مزدحماً."], p2:["مطبخ أخضر الساعة ٣ قد يكون أحمر الساعة ٧."]},
  {h:"١٨. كيف يساعدك هذا التطبيق", p:["Stack Check يجيب عن سؤال واحد: هل أضيف هذا الطلب دون تدمير مساري الحالي؟"], p2:["تحقّق ← أضف طلباً ← انطلق. يجمع المسار والمسافة والتوقيت والانتظار وطلباتك الحالية."], note:"لا يقرّر عنك، بل يضع الحقائق المهمة أمامك بسرعة."},
  {h:"١٩. سبعة أخطاء شائعة", ul:["مطاردة الأجر — ١٥£ ليست جيدة تلقائياً","تجاهل المطبخ — ٧£ مع انتظار ٣٠ دقيقة مال سيّئ","تجاهل الاتجاه","الإفراط في الدمج","حساب الأميال فقط","نسيان رحلة العودة","التفكير بالتكلفة الغارقة"]},
  {h:"٢٠. المعادلة الأساسية", p:["القيمة الحقيقية = الأجر − تكلفة الوقت − المسافة الإضافية − خطر الانتظار."], p2:["قيمة الدمج = الأجر الإضافي − الوقت الإضافي − المسافة الإضافية − خطر التأخير."], note:"لا تحتاج حساباً مثالياً، بل قرارات ثابتة."},
  {h:"٢١. ورقة سريعة", ul:["أخضر — أجر جيد، انتظار قصير، نفس الاتجاه. اقبل غالباً.","برتقالي — احسبها أولاً.","أحمر — انتظار طويل، اتجاه خاطئ، التفاف كبير، خطر على طلبك الحالي. ارفض غالباً."]},
  {h:"٢٢. الهدف الحقيقي", p:["ليس أكبر عدد توصيلات، بل أعلى £/ساعة مستدام مع مخاطرة محكومة."], p2:["سائق بـ ٢٥ طلباً سيّئ الاختيار قد يربح أقل من سائق بـ ١٨ طلباً محكماً."], note:"الطلب الجيد يحسّن الوردية كلها، لا العشر دقائق القادمة فقط."},
]};

const HI = { title:"सीखें", subtitle:"मल्टी-ऐप ड्राइविंग — प्रति घंटा ज़्यादा कमाई", sections:[
  {h:"1. मल्टी-ऐपिंग क्या है", p:["एक ही समय पर एक से ज़्यादा प्लेटफ़ॉर्म पर काम करना — Uber Eats, Deliveroo और Just Eat."], note:"लक्ष्य सबसे ज़्यादा ऑर्डर नहीं, बल्कि प्रति घंटा सबसे ज़्यादा कमाई है — दूरी, इंतज़ार और जोखिम काबू में रखते हुए।"},
  {h:"2. हर ऑर्डर के पाँच पहलू", ul:["पेमेंट","दूरी","असली समय","दिशा — कहाँ छोड़ेगा","इंतज़ार का जोखिम"], p:["सबसे ज़्यादा पैसे वाला ऑर्डर हमेशा सबसे अच्छा नहीं होता।","£8 / 2 मील / 20 मिनट, £10 / 6 मील / 40 मिनट से बेहतर है।"]},
  {h:"3. अपना समय बचाइए", p:["सबसे बड़ा खर्च ईंधन नहीं, बेकार समय है: बिना तैयार खाने तक जाना, इंतज़ार, वापसी और खाली बैठना।"], p2:["एक घंटे में £30 यानी £30/घंटा। वही £30 डेढ़ घंटे में यानी £20/घंटा।"], note:"वही पैसा अच्छी या बुरी शिफ़्ट बनाता है — फ़र्क सिर्फ़ घड़ी का है।"},
  {h:"4. रेस्टोरेंट का इंतज़ार पढ़ें", p:["इंतज़ार का समय ही मुनाफ़े और नुक़सान के बीच सबसे बड़ा अंतर है।"], ul:["हरा — कम, अनुमानित। स्टैक के लिए अच्छा।","नारंगी — मध्यम। सोच-समझकर लें।","लाल — लंबा या अनिश्चित। स्टैक न करें।"], p2:["ऐप में: हरा 45 मिनट से कम, नारंगी 45–60, लाल एक घंटे से ज़्यादा।"]},
  {h:"5. ऑर्डर स्टैक करना", p:["स्टैक यानी दो ऑर्डर जो सच में एक ही ट्रिप में फ़िट हों।"], note:"पूछें: क्या दोनों बिना पहले ग्राहक को बहुत देर किए हो सकते हैं? यह नहीं कि दो ऑर्डर मतलब दोगुना पैसा।"},
  {h:"6. अच्छा स्टैक", ul:["£7 Uber और £6 Deliveroo","दोनों रेस्टोरेंट पास","दोनों ड्रॉप एक ही दिशा","दोनों किचन आमतौर पर तेज़"], p:["कुल £13। अगर दूसरा सिर्फ़ 10–15 मिनट जोड़े तो यह बेहतरीन स्टैक है।"]},
  {h:"7. बुरा स्टैक", ul:["आपके पास पहले से £8","नया £6","उसका रेस्टोरेंट 3 मील उलटी दिशा","किचन देर के लिए बदनाम"], p:["£6 आपके £8 की क़ीमत बिगाड़ सकता है। आमतौर पर मना करें।"]},
  {h:"8. दिशा, दूरी से ज़्यादा अहम", p:["सही दिशा में तीन मील, ग़लत दिशा में एक मील से बेहतर है।"], p2:["आप उत्तर जा रहे हैं। A: 3 मील उत्तर, £7। B: 1 मील दक्षिण, £6। अक्सर A बेहतर — B के बाद खाली लौटना पड़ेगा, और खाली मील बिना पैसे का समय है।"]},
  {h:"9. ज़ोन छोड़ने की छिपी लागत", p:["5 मील के £10 अच्छे लगते हैं। पर आप रेस्टोरेंट से 5 मील दूर ख़त्म करते हैं, फिर 4 मील ख़ाली लौटते हैं।"], note:"असल दूरी: 9 मील। हमेशा देखें ऑर्डर आपको कहाँ छोड़ेगा।"},
  {h:"10. हर ऐप पर माँग अलग", p:["प्लेटफ़ॉर्म की ताक़त बदलती रहती है:"], ul:["रविवार को अक्सर Uber मज़बूत","शनिवार को अक्सर Just Eat मज़बूत","शाम-रात ज़्यादा व्यस्त","लगभग 4–6 बजे अहम दौर"], p2:["सबसे अच्छा प्लेटफ़ॉर्म दिन, समय, इलाक़े, रेस्टोरेंट, मौसम, माँग और ड्राइवरों की संख्या से बदलता है।"]},
  {h:"11. «एक अच्छा ऑर्डर» का जाल", p:["£12 शानदार लगता है। फिर: 10 मिनट पहुँचने में, 20 इंतज़ार, 30 ड्राइविंग, 10 वापसी — कुल 70 मिनट, यानी £10/घंटा से भी कम।"], note:"हमेशा देखें: पेमेंट ÷ वास्तविक कुल समय।"},
  {h:"12. अच्छा नतीजा कैसा दिखता है", p:["एक दर्ज शिफ़्ट: 5 घंटे में 16 ऑर्डर, £134.69 — £26.94/घंटा।"], p2:["लंबे समय के आँकड़े: आम तौर पर £25–£30/घंटा, मज़बूत वीकेंड पर £35–£40, लगभग 45–50 घंटों में क़रीब £1,338।"], note:"मल्टी-ऐपिंग तब काम करती है जब प्लेटफ़ॉर्म एक-दूसरे के ख़ाली समय भरें, आपस में न लड़ें।"},
  {h:"13. स्वीकार करने से पहले सात जाँच", ul:["पेमेंट — समय के लायक़?","दूरी — कितने मील?","दिशा — उत्पादक इलाक़े में रखेगा?","रेस्टोरेंट — तेज़ या धीमा?","मौजूदा ऑर्डर — टकराव तो नहीं?","वापसी — कहाँ ख़त्म होंगे?","प्रति घंटा मूल्य — कुल ÷ समय"], p:["अगर नया ऑर्डर पूरा रूट बिगाड़े — मना करें।"]},
  {h:"14. उदाहरण — स्वीकार", p:["आपके पास £8 Deliveroo, खाना 5 मिनट में, ड्रॉप उत्तर। £7 Uber आता है: रेस्टोरेंट 500 मीटर, ड्रॉप भी उत्तर।"], ul:["एक ही दिशा","बहुत कम अतिरिक्त दूरी","दोनों जल्दी उठ जाएँगे","सार्थक अतिरिक्त कमाई"], note:"मज़बूत स्टैक। ले लें।"},
  {h:"15. उदाहरण — मना करें", p:["आपके पास £9 Just Eat, खाना लगभग तैयार, ड्रॉप पूर्व। £6 Uber आता है: रेस्टोरेंट 2 मील पश्चिम, धीमा किचन, ग्राहक और पश्चिम।"], ul:["अतिरिक्त ड्राइविंग","अतिरिक्त इंतज़ार","ग़लत दिशा","£9 पर ख़तरा"], note:"मना करें।"},
  {h:"16. रेस्टोरेंट की जानकारी पूँजी है", p:["पर्याप्त डिलीवरी के बाद आपका अपना डेटाबेस बनता है: कौन तेज़, कौन धीमा, कौन किन घंटों में धीमा पड़ता है।"], note:"यह जानकारी अक्सर स्क्रीन पर दिख रहे पेमेंट से ज़्यादा क़ीमती होती है।"},
  {h:"17. याद्दाश्त को डेटा बनाइए", p:["याद्दाश्त धोखा देती है। रेस्टोरेंट, समय, इंतज़ार के मिनट, प्लेटफ़ॉर्म, दिन और व्यस्तता दर्ज करें।"], p2:["3 बजे हरा किचन 7 बजे लाल हो सकता है।"]},
  {h:"18. यह ऐप कैसे मदद करता है", p:["Stack Check एक ही सवाल का जवाब देता है: क्या मैं यह ऑर्डर लेकर अपना मौजूदा रूट बिगाड़े बिना जोड़ सकता हूँ?"], p2:["CHECK → ADD ORDER → DRIVE। यह रूट, दूरी, समय, इंतज़ार और मौजूदा ऑर्डर जोड़कर दिखाता है।"], note:"यह आपके लिए फ़ैसला नहीं करता — ज़रूरी जानकारी तेज़ी से सामने रखता है।"},
  {h:"19. सात आम ग़लतियाँ", ul:["बड़े पेमेंट के पीछे भागना","किचन को नज़रअंदाज़ करना","दिशा को नज़रअंदाज़ करना","बहुत ज़्यादा स्टैक","सिर्फ़ मील गिनना","वापसी भूल जाना","डूबी लागत की सोच"]},
  {h:"20. मूल सूत्र", p:["असली मूल्य = पेमेंट − समय की लागत − अतिरिक्त दूरी − इंतज़ार का जोखिम।"], p2:["स्टैक मूल्य = अतिरिक्त पेमेंट − अतिरिक्त समय − अतिरिक्त दूरी − देरी का जोखिम।"], note:"बिलकुल सही गणित नहीं, लगातार सही फ़ैसले चाहिए।"},
  {h:"21. तेज़ चीट शीट", ul:["हरा — अच्छा पेमेंट, कम इंतज़ार, वही दिशा। आमतौर पर लें।","नारंगी — पहले हिसाब लगाएँ।","लाल — लंबा इंतज़ार, ग़लत दिशा, बड़ा चक्कर, मौजूदा ऑर्डर पर ख़तरा। आमतौर पर मना करें।"]},
  {h:"22. असली मक़सद", p:["सबसे ज़्यादा डिलीवरी नहीं, बल्कि क़ाबू में जोखिम के साथ सबसे ऊँचा टिकाऊ £/घंटा।"], p2:["25 ख़राब चुने ऑर्डर वाला ड्राइवर, 18 सही ऑर्डर वाले से कम कमा सकता है।"], note:"अच्छा ऑर्डर पूरी शिफ़्ट सुधारता है, सिर्फ़ अगले दस मिनट नहीं।"},
]};

const UR = { title:"سیکھیں", subtitle:"ملٹی ایپ ڈرائیونگ — فی گھنٹہ زیادہ کمائیں", sections:[
  {h:"١. ملٹی ایپنگ کیا ہے", p:["ایک ہی وقت میں ایک سے زیادہ پلیٹ فارم پر کام کرنا — Uber Eats، Deliveroo اور Just Eat۔"], note:"مقصد سب سے زیادہ آرڈر نہیں، بلکہ فی گھنٹہ سب سے زیادہ کمائی ہے — فاصلہ، انتظار اور خطرہ قابو میں رکھتے ہوئے۔"},
  {h:"٢. ہر آرڈر کی پانچ قدریں", ul:["اجرت","فاصلہ","اصل وقت","سمت — کہاں چھوڑے گا","انتظار کا خطرہ"], p:["سب سے زیادہ اجرت والا آرڈر ہمیشہ بہترین نہیں ہوتا۔","£8 / 2 میل / 20 منٹ، £10 / 6 میل / 40 منٹ سے بہتر ہے۔"]},
  {h:"٣. اپنا وقت بچائیں", p:["سب سے بڑا خرچ ایندھن نہیں، ضائع وقت ہے: غیر تیار کھانے تک جانا، انتظار، واپسی اور خالی بیٹھنا۔"], p2:["ایک گھنٹے میں £30 یعنی £30/گھنٹہ۔ وہی £30 ڈیڑھ گھنٹے میں یعنی £20/گھنٹہ۔"], note:"وہی رقم اچھی یا بری شفٹ بناتی ہے — فرق صرف گھڑی کا ہے۔"},
  {h:"٤. ریستوران کا انتظار پڑھیں", p:["انتظار کا وقت ہی نفع اور نقصان کے درمیان سب سے بڑا فرق ہے۔"], ul:["سبز — کم اور متوقع۔ اسٹیک کے لیے اچھا۔","نارنجی — درمیانہ۔ احتیاط سے لیں۔","سرخ — طویل یا غیر یقینی۔ اسٹیک نہ کریں۔"], p2:["ایپ میں: سبز 45 منٹ سے کم، نارنجی 45–60، سرخ ایک گھنٹے سے زیادہ۔"]},
  {h:"٥. آرڈر اسٹیک کرنا", p:["اسٹیک یعنی دو آرڈر جو واقعی ایک ہی سفر میں سما جائیں۔"], note:"پوچھیں: کیا دونوں پہلے گاہک کو زیادہ دیر کیے بغیر ہو سکتے ہیں؟ یہ نہیں کہ دو آرڈر یعنی دُگنا پیسہ۔"},
  {h:"٦. اچھا اسٹیک", ul:["£7 Uber اور £6 Deliveroo","دونوں ریستوران قریب","دونوں ڈراپ ایک سمت","دونوں کچن عموماً تیز"], p:["کل £13۔ اگر دوسرا صرف 10–15 منٹ بڑھائے تو یہ بہترین اسٹیک ہے۔"]},
  {h:"٧. برا اسٹیک", ul:["آپ کے پاس پہلے £8","نیا £6","اس کا ریستوران 3 میل مخالف سمت","کچن طویل انتظار کے لیے مشہور"], p:["£6 آپ کے £8 کی قدر تباہ کر سکتا ہے۔ عموماً انکار کریں۔"]},
  {h:"٨. سمت، فاصلے سے اہم", p:["درست سمت میں تین میل، غلط سمت میں ایک میل سے بہتر ہے۔"], p2:["آپ شمال جا رہے ہیں۔ A: 3 میل شمال، £7۔ B: 1 میل جنوب، £6۔ اکثر A بہتر — B کے بعد خالی واپسی، اور خالی میل بلا معاوضہ وقت ہے۔"]},
  {h:"٩. زون چھوڑنے کی پوشیدہ قیمت", p:["5 میل کے £10 اچھے لگتے ہیں۔ مگر آپ ریستورانوں سے 5 میل دور ختم کرتے ہیں، پھر 4 میل خالی لوٹتے ہیں۔"], note:"اصل حرکت: 9 میل۔ ہمیشہ دیکھیں آرڈر آپ کو کہاں چھوڑے گا۔"},
  {h:"١٠. ہر ایپ پر طلب مختلف", p:["پلیٹ فارم کی طاقت بدلتی رہتی ہے:"], ul:["اتوار کو اکثر Uber مضبوط","ہفتہ کو اکثر Just Eat مضبوط","شام اور رات زیادہ مصروف","تقریباً 4–6 بجے اہم دورانیہ"], p2:["بہترین پلیٹ فارم دن، وقت، علاقے، ریستوران، موسم، طلب اور ڈرائیوروں کی تعداد سے بدلتا ہے۔"]},
  {h:"١١. «ایک اچھے آرڈر» کا جال", p:["£12 شاندار لگتا ہے۔ پھر: 10 منٹ پہنچنے میں، 20 انتظار، 30 ڈرائیونگ، 10 واپسی — کل 70 منٹ، یعنی £10/گھنٹہ سے بھی کم۔"], note:"ہمیشہ دیکھیں: اجرت ÷ حقیقی کل وقت۔"},
  {h:"١٢. اچھا نتیجہ کیسا ہوتا ہے", p:["ایک ریکارڈ شدہ شفٹ: 5 گھنٹوں میں 16 آرڈر، £134.69 — £26.94/گھنٹہ۔"], p2:["طویل مدتی: عموماً £25–£30/گھنٹہ، مضبوط ویک اینڈ پر £35–£40، تقریباً 45–50 گھنٹوں میں £1,338۔"], note:"ملٹی ایپنگ تب کارگر ہے جب پلیٹ فارم ایک دوسرے کے خلا پُر کریں، آپس میں نہ ٹکرائیں۔"},
  {h:"١٣. قبول کرنے سے پہلے سات جانچ", ul:["اجرت — وقت کے قابل؟","فاصلہ — کتنے میل؟","سمت — کارآمد علاقے میں رکھے گی؟","ریستوران — تیز یا سست؟","موجودہ آرڈر — ٹکراؤ تو نہیں؟","واپسی — کہاں ختم ہوں گے؟","فی گھنٹہ قدر — کل ÷ وقت"], p:["اگر نیا آرڈر پورا روٹ بگاڑے — انکار کریں۔"]},
  {h:"١٤. مثال — قبول کریں", p:["آپ کے پاس £8 Deliveroo، کھانا 5 منٹ میں، ڈراپ شمال۔ £7 Uber آتا ہے: ریستوران 500 میٹر، ڈراپ بھی شمال۔"], ul:["ایک ہی سمت","بہت کم اضافی فاصلہ","دونوں جلد اٹھ جائیں گے","بامعنی اضافی آمدنی"], note:"مضبوط اسٹیک۔ لے لیں۔"},
  {h:"١٥. مثال — انکار کریں", p:["آپ کے پاس £9 Just Eat، کھانا تقریباً تیار، ڈراپ مشرق۔ £6 Uber آتا ہے: ریستوران 2 میل مغرب، سست کچن، گاہک مزید مغرب۔"], ul:["اضافی ڈرائیونگ","اضافی انتظار","غلط سمت","£9 پر خطرہ"], note:"انکار کریں۔"},
  {h:"١٦. ریستوران کی معلومات سرمایہ ہیں", p:["کافی ڈیلیوری کے بعد آپ کا اپنا ڈیٹابیس بنتا ہے: کون تیز، کون سست، کون کن گھنٹوں میں سست پڑتا ہے۔"], note:"یہ معلومات اکثر اسکرین پر نظر آنے والی اجرت سے زیادہ قیمتی ہوتی ہیں۔"},
  {h:"١٧. یادداشت کو ڈیٹا بنائیں", p:["یادداشت دھوکا دیتی ہے۔ ریستوران، وقت، انتظار کے منٹ، پلیٹ فارم، دن اور مصروفیت درج کریں۔"], p2:["3 بجے سبز کچن 7 بجے سرخ ہو سکتا ہے۔"]},
  {h:"١٨. یہ ایپ کیسے مدد کرتی ہے", p:["Stack Check ایک ہی سوال کا جواب دیتا ہے: کیا میں یہ آرڈر اپنے موجودہ روٹ کو بگاڑے بغیر شامل کر سکتا ہوں؟"], p2:["CHECK → ADD ORDER → DRIVE۔ یہ روٹ، فاصلہ، وقت، انتظار اور موجودہ آرڈر جوڑ کر دکھاتا ہے۔"], note:"یہ آپ کے لیے فیصلہ نہیں کرتا — ضروری حقائق تیزی سے سامنے رکھتا ہے۔"},
  {h:"١٩. سات عام غلطیاں", ul:["بڑی اجرت کے پیچھے بھاگنا","کچن کو نظرانداز کرنا","سمت کو نظرانداز کرنا","حد سے زیادہ اسٹیک","صرف میل گننا","واپسی بھول جانا","ڈوبی لاگت کی سوچ"]},
  {h:"٢٠. بنیادی فارمولا", p:["اصل قدر = اجرت − وقت کی لاگت − اضافی فاصلہ − انتظار کا خطرہ۔"], p2:["اسٹیک قدر = اضافی اجرت − اضافی وقت − اضافی فاصلہ − تاخیر کا خطرہ۔"], note:"بالکل درست حساب نہیں، مسلسل درست فیصلے چاہئیں۔"},
  {h:"٢١. تیز چیٹ شیٹ", ul:["سبز — اچھی اجرت، کم انتظار، وہی سمت۔ عموماً لیں۔","نارنجی — پہلے حساب لگائیں۔","سرخ — طویل انتظار، غلط سمت، بڑا چکر، موجودہ آرڈر پر خطرہ۔ عموماً انکار کریں۔"]},
  {h:"٢٢. اصل مقصد", p:["سب سے زیادہ ڈیلیوری نہیں، بلکہ قابو میں خطرے کے ساتھ بلند ترین پائیدار £/گھنٹہ۔"], p2:["25 غلط چنے آرڈر والا ڈرائیور، 18 درست آرڈر والے سے کم کما سکتا ہے۔"], note:"اچھا آرڈر پوری شفٹ بہتر کرتا ہے، صرف اگلے دس منٹ نہیں۔"},
]};

const PT = { title:"APRENDER", subtitle:"Trabalhar com várias apps — ganhar mais por hora", sections:[
  {h:"1. O que é trabalhar com várias apps", p:["Trabalhar em mais de uma plataforma ao mesmo tempo — Uber Eats, Deliveroo e Just Eat."], note:"O objetivo não é o maior número de pedidos, mas o maior valor por hora, com distância, espera e risco sob controlo."},
  {h:"2. Cada pedido tem cinco valores", ul:["Pagamento","Distância","Tempo real","Direção — onde te deixa","Risco de espera"], p:["O pedido mais bem pago não é automaticamente o melhor.","£8 / 2 milhas / 20 min é melhor do que £10 / 6 milhas / 40 min."]},
  {h:"3. Protege o teu tempo", p:["O maior custo não é o combustível, é o tempo morto: ir buscar comida que não está pronta, esperar, voltar à zona movimentada e ficar parado."], p2:["£30 numa hora são £30/hora. Os mesmos £30 em hora e meia são £20/hora."], note:"O mesmo dinheiro é um bom ou mau turno — só o relógio decide."},
  {h:"4. Ler o tempo de espera", p:["A espera é a maior diferença entre um turno lucrativo e um turno mau."], ul:["Verde — espera curta e previsível. Boa para juntar pedidos.","Laranja — média. Aceita com cuidado.","Vermelho — longa ou imprevisível. Normalmente não juntes."], p2:["Na app: verde abaixo de 45 minutos, laranja 45–60, vermelho acima de uma hora."]},
  {h:"5. Juntar pedidos", p:["Juntar é pegar em dois pedidos que realmente cabem na mesma viagem."], note:"Pergunta: consigo fazer os dois sem atrasar muito o primeiro cliente? E não: dois pedidos é o dobro do dinheiro."},
  {h:"6. Boa combinação", ul:["£7 na Uber e £6 na Deliveroo","Restaurantes próximos","Entregas na mesma direção","Ambas as cozinhas normalmente rápidas"], p:["£13 no total. Se o segundo acrescentar só 10–15 minutos, é excelente."]},
  {h:"7. Má combinação", ul:["Já tens £8","O novo paga £6","O restaurante fica a 3 milhas no sentido oposto","Cozinha com histórico de esperas longas"], p:["Os £6 podem destruir o valor dos £8. Normalmente, recusa."]},
  {h:"8. A direção vale mais que a distância", p:["Três milhas na direção certa valem mais do que uma na direção errada."], p2:["Vais para norte. A: 3 milhas a norte por £7. B: 1 milha a sul por £6. A costuma ser melhor — depois de B voltas vazio, e milhas vazias são tempo não pago."]},
  {h:"9. O custo escondido de sair da zona", p:["£10 por 5 milhas parece bom. Mas acabas a 5 milhas dos restaurantes e voltas 4 milhas sem nada."], note:"Movimento real: 9 milhas. Pergunta sempre onde o pedido te deixa."},
  {h:"10. A procura não é igual em todas as apps", p:["A força de cada plataforma muda. Padrões a observar:"], ul:["Uber costuma ser forte ao domingo","Just Eat costuma ser forte ao sábado","Noites geralmente mais densas","Cerca das 16h–18h um período importante"], p2:["A melhor plataforma muda com o dia, a hora, a zona, o restaurante, o tempo, a procura e o número de estafetas."]},
  {h:"11. A armadilha do «pedido bom»", p:["£12 parece excelente. Depois: 10 min até ao restaurante, 20 à espera, 30 a conduzir, 10 a voltar. São 70 minutos — menos de £10/hora."], note:"Avalia sempre: pagamento ÷ tempo total realista."},
  {h:"12. Como é um bom resultado", p:["Um turno registado: £134,69 em 5 horas com 16 pedidos — £26,94/hora."], p2:["Referências: £25–£30/hora normalmente, £35–£40 em fins de semana fortes, cerca de £1.338 em 45–50 horas."], note:"Funciona quando as plataformas preenchem os intervalos umas das outras em vez de competirem pelo teu tempo."},
  {h:"13. Sete verificações antes de aceitar", ul:["Pagamento — vale o tempo?","Distância — quantas milhas?","Direção — mantém-te produtivo?","Restaurante — rápido ou lento?","Pedido atual — vai interferir?","Regresso — onde acabas?","Valor à hora — total ÷ tempo"], p:["Se o novo pedido estraga a rota toda, recusa."]},
  {h:"14. Exemplo — aceitar", p:["Tens £8 da Deliveroo, comida em 5 minutos, entrega a norte. Aparece £7 da Uber: restaurante a 500 m, entrega também a norte."], ul:["Mesma direção","Distância extra mínima","Ambos rápidos de levantar","Rendimento extra real"], note:"Boa combinação. Aceita."},
  {h:"15. Exemplo — recusar", p:["Tens £9 da Just Eat, comida quase pronta, entrega a este. Aparece £6 da Uber: restaurante a 2 milhas a oeste, cozinha lenta, cliente ainda mais a oeste."], ul:["Mais condução","Mais espera","Direção errada","Põe os £9 em risco"], note:"Recusa."},
  {h:"16. Conhecer os restaurantes é um ativo", p:["Com o tempo constróis a tua base de dados: quais cozinhas são rápidas, quais são lentas, quais abrandam a certas horas."], note:"Esse conhecimento vale muitas vezes mais do que o valor no ecrã."},
  {h:"17. Transforma memória em dados", p:["A memória falha. Regista restaurante, hora, minutos de espera, plataforma, dia e se estava movimentado."], p2:["Uma cozinha verde às 15h pode ser vermelha às 19h."]},
  {h:"18. Como esta app ajuda", p:["O Stack Check responde a uma pergunta: consigo acrescentar este pedido sem destruir a rota que já tenho?"], p2:["CHECK → ADICIONAR PEDIDO → CONDUZIR. Junta rota, distância, tempo, espera e os pedidos que já tens."], note:"Não decide por ti — põe os factos importantes à tua frente depressa."},
  {h:"19. Sete erros comuns", ul:["Perseguir o valor — £15 não é automaticamente bom","Ignorar a cozinha","Ignorar a direção","Juntar pedidos a mais","Contar só milhas","Esquecer o regresso","Pensamento de custo afundado"]},
  {h:"20. A fórmula central", p:["Valor real = pagamento − custo de tempo − distância extra − risco de espera."], p2:["Valor da combinação = pagamento extra − tempo extra − distância extra − risco de atraso."], note:"Não precisas de contas perfeitas. Precisas de decisões consistentes."},
  {h:"21. Guia rápido", ul:["VERDE — bom pagamento, espera curta, mesma direção. Normalmente aceita.","LARANJA — faz as contas primeiro.","VERMELHO — espera longa, direção errada, grande desvio, risco para o pedido atual. Normalmente recusa."]},
  {h:"22. O verdadeiro objetivo", p:["Não é o maior número de entregas, é o £/hora sustentável mais alto com risco controlado."], p2:["Um estafeta com 25 pedidos mal escolhidos pode ganhar menos do que outro com 18 bem posicionados."], note:"Um bom pedido melhora o turno inteiro, não só os próximos dez minutos."},
]};

const ZH = { title:"学习", subtitle:"多平台跑单 — 如何提高时薪", sections:[
  {h:"1. 什么是多平台跑单", p:["同时在多个平台接单 — Uber Eats、Deliveroo 和 Just Eat。"], note:"目标不是接最多的单，而是在控制距离、等待和风险的前提下，赚取最高时薪。"},
  {h:"2. 每单有五个要素", ul:["报酬","距离","真实耗时","方向 — 会把你带到哪里","等待风险"], p:["报酬最高的单不一定最好。","£8／2 英里／20 分钟 优于 £10／6 英里／40 分钟。"]},
  {h:"3. 首先保护你的时间", p:["最大的成本不是油费，而是空耗时间：去取还没做好的餐、排队等待、空车返回热区、无单空等。"], p2:["一小时赚 £30 就是 £30/小时；同样 £30 花一个半小时就只有 £20/小时。"], note:"同样的钱，是好班还是烂班，只取决于时钟。"},
  {h:"4. 读懂餐厅等待时间", p:["等待时间是盈利与亏本之间最大的差别。"], ul:["绿色 — 等待短且可预测，适合并单。","橙色 — 中等，谨慎接。","红色 — 长或不可预测，通常不要并单。"], p2:["本应用中：绿色少于 45 分钟，橙色 45–60，红色超过一小时。"]},
  {h:"5. 并单", p:["并单是指两个订单确实能在一趟行程内完成。"], note:"要问：我能否在不严重耽误第一位顾客的情况下完成两单？而不是：两单等于双倍收入。"},
  {h:"6. 好的并单", ul:["£7 的 Uber 单和 £6 的 Deliveroo 单","两家餐厅相距很近","两个送达点同一方向","两家后厨通常很快"], p:["合计 £13。若第二单只多花 10–15 分钟，这就是极佳的并单。"]},
  {h:"7. 差的并单", ul:["你已有一单 £8","新单 £6","餐厅在反方向 3 英里外","该后厨以等待时间长著称"], p:["这 £6 可能毁掉 £8 的价值。通常应当拒绝。"]},
  {h:"8. 方向比距离更重要", p:["朝对的方向跑 3 英里，胜过朝错的方向跑 1 英里。"], p2:["你正往北走。A：向北 3 英里，£7。B：向南 1 英里，£6。通常 A 更好 — 跑完 B 你要空车折返，而空跑就是没有报酬的时间。"]},
  {h:"9. 离开热区的隐性成本", p:["£10 跑 5 英里看起来不错。但你结束时距离出单餐厅 5 英里，还要空车开 4 英里回来。"], note:"实际移动：9 英里。永远要问这一单会把你留在哪里。"},
  {h:"10. 各平台的需求并不相同", p:["平台强弱会变化，值得留意的规律："], ul:["周日 Uber 往往较强","周六 Just Eat 往往较强","傍晚和夜间通常更密集","大约 16:00–18:00 是重要的起量时段"], p2:["最佳平台会随日期、时间、区域、餐厅、天气、需求和骑手数量而改变。"]},
  {h:"11.「单看这一单很好」的陷阱", p:["£12 看起来很棒。然后：10 分钟到店、20 分钟等待、30 分钟行驶、10 分钟返回热区，合计 70 分钟 — 不到 £10/小时。"], note:"永远按：报酬 ÷ 实际总耗时 来判断。"},
  {h:"12. 好成绩长什么样", p:["一次记录的班次：5 小时 16 单，£134.69 — £26.94/小时。"], p2:["长期参考：通常 £25–£30/小时，周末高峰 £35–£40，约 45–50 小时累计约 £1,338。"], note:"当各平台互相填补空档而不是争抢你的时间时，多平台跑单才真正有效。"},
  {h:"13. 接单前的七项检查", ul:["报酬 — 值这个时间吗？","距离 — 多少英里？","方向 — 能否留在高效区域？","餐厅 — 出餐快还是慢？","当前订单 — 会不会冲突？","返程 — 会在哪里结束？","时薪价值 — 总收入 ÷ 总时间"], p:["如果新单会破坏整条路线，就拒绝。"]},
  {h:"14. 实例 — 接单", p:["你手上有 £8 的 Deliveroo 单，5 分钟出餐，送往北面。出现 £7 的 Uber 单：餐厅在 500 米外，同样送往北面。"], ul:["方向一致","额外距离极小","两单都能很快取到","额外收入可观"], note:"强并单，接。"},
  {h:"15. 实例 — 拒单", p:["你手上有 £9 的 Just Eat 单，餐快好了，送往东面。出现 £6 的 Uber 单：餐厅在西面 2 英里，后厨慢，顾客还要更往西。"], ul:["额外行驶","额外等待","方向相反","威胁到 £9 那一单"], note:"拒绝。"},
  {h:"16. 餐厅知识就是资产", p:["跑够单量后，你会形成自己的数据库：哪家快、哪家慢、哪家在特定时段变慢、哪家会提前备餐。"], note:"这些经验往往比屏幕上的报酬更值钱。"},
  {h:"17. 把记忆变成数据", p:["记忆会失真。记录餐厅、时间、等待分钟数、平台、星期以及当时是否繁忙。"], p2:["下午 3 点是绿色的后厨，晚上 7 点可能变成红色。"]},
  {h:"18. 这个应用能帮什么", p:["Stack Check 只回答一个问题：我能否在不破坏现有路线的前提下加上这一单？"], p2:["CHECK → 添加订单 → 出发。它把路线、距离、时间、餐厅等待和你已有的订单结合在一起。"], note:"它不替你做决定，而是让关键信息快速呈现。"},
  {h:"19. 七个常见错误", ul:["只追高报酬 — £15 不一定好","忽视后厨速度","忽视方向","并单过多","只看里程","忘记返程","沉没成本思维"]},
  {h:"20. 核心公式", p:["真实价值 = 报酬 − 时间成本 − 额外距离 − 等待风险。"], p2:["并单价值 = 额外报酬 − 额外时间 − 额外距离 − 延误风险。"], note:"不需要完美的计算，需要一致的判断。"},
  {h:"21. 快速对照表", ul:["绿色 — 报酬好、等待短、同方向，通常接。","橙色 — 先算一算。","红色 — 等待长、方向错、绕路远、危及当前订单，通常拒。"]},
  {h:"22. 真正的目标", p:["不是送最多的单，而是在风险可控下取得最高且可持续的时薪。"], p2:["跑 25 个选得差的单，可能不如跑 18 个位置合适的单赚得多。"], note:"好的订单让整个班次更好，而不只是接下来的十分钟。"},
]};

const RO = { title:"ÎNVAȚĂ", subtitle:"Lucrul pe mai multe aplicații — cum câștigi mai mult pe oră", sections:[
  {h:"1. Ce înseamnă multi-apping", p:["Să lucrezi pe mai multe platforme în același timp — Uber Eats, Deliveroo și Just Eat."], note:"Scopul nu e cel mai mare număr de comenzi, ci cel mai mare câștig pe oră, cu distanța, așteptarea și riscul sub control."},
  {h:"2. Fiecare comandă are cinci valori", ul:["Plata","Distanța","Timpul real","Direcția — unde te lasă","Riscul de așteptare"], p:["Comanda cel mai bine plătită nu e automat cea mai bună.","£8 / 2 mile / 20 min bate £10 / 6 mile / 40 min."]},
  {h:"3. Protejează-ți timpul", p:["Cel mai mare cost nu e combustibilul, ci timpul mort: drumul spre mâncare nepregătită, așteptarea, întoarcerea în zona activă și statul degeaba."], p2:["£30 într-o oră înseamnă £30/oră. Aceiași £30 în o oră și jumătate înseamnă £20/oră."], note:"Aceiași bani înseamnă tură bună sau proastă — decide doar ceasul."},
  {h:"4. Cum citești timpul de așteptare", p:["Așteptarea e cea mai mare diferență între o tură profitabilă și una proastă."], ul:["Verde — scurtă și previzibilă. Bună pentru comenzi combinate.","Portocaliu — moderată. Acceptă cu atenție.","Roșu — lungă sau imprevizibilă. De obicei nu combina."], p2:["În aplicație: verde sub 45 de minute, portocaliu 45–60, roșu peste o oră."]},
  {h:"5. Combinarea comenzilor", p:["O combinație înseamnă două comenzi care chiar încap în același drum."], note:"Întreabă: pot face ambele fără să întârzii serios primul client? Nu: două comenzi înseamnă bani dubli."},
  {h:"6. O combinație bună", ul:["£7 pe Uber și £6 pe Deliveroo","Restaurantele aproape unul de altul","Livrări în aceeași direcție","Ambele bucătării de obicei rapide"], p:["£13 în total. Dacă a doua adaugă doar 10–15 minute, e excelentă."]},
  {h:"7. O combinație proastă", ul:["Ai deja £8","Cea nouă plătește £6","Restaurantul e la 3 mile în direcția opusă","Bucătărie cunoscută pentru așteptări lungi"], p:["Cei £6 pot distruge valoarea celor £8. De obicei, refuză."]},
  {h:"8. Direcția bate distanța", p:["Trei mile în direcția bună bat o milă în direcția greșită."], p2:["Mergi spre nord. A: 3 mile nord, £7. B: 1 milă sud, £6. De obicei A e mai bună — după B te întorci gol, iar milele goale sunt timp neplătit."]},
  {h:"9. Costul ascuns al ieșirii din zonă", p:["£10 pentru 5 mile pare bine. Dar termini la 5 mile de restaurante și te întorci 4 mile fără nimic."], note:"Mișcare reală: 9 mile. Întreabă mereu unde te lasă comanda."},
  {h:"10. Cererea nu e la fel pe fiecare aplicație", p:["Puterea platformelor se schimbă. Tipare de urmărit:"], ul:["Uber adesea puternic duminica","Just Eat adesea puternic sâmbăta","Serile și nopțile mai dense","Aproximativ 16–18 o perioadă importantă"], p2:["Cea mai bună platformă se schimbă cu ziua, ora, zona, restaurantul, vremea, cererea și numărul de curieri."]},
  {h:"11. Capcana «unei comenzi bune»", p:["£12 pare excelent. Apoi: 10 minute până la restaurant, 20 de așteptare, 30 de condus, 10 de întors. Total 70 de minute — sub £10/oră."], note:"Judecă mereu: plata ÷ timpul total realist."},
  {h:"12. Cum arată un rezultat bun", p:["O tură înregistrată: £134,69 în 5 ore, 16 comenzi — £26,94/oră."], p2:["Repere: £25–£30/oră de obicei, £35–£40 în weekenduri puternice, circa £1.338 în 45–50 de ore."], note:"Funcționează când platformele umplu golurile celorlalte, nu când concurează pentru timpul tău."},
  {h:"13. Șapte verificări înainte de acceptare", ul:["Plata — merită timpul?","Distanța — câte mile?","Direcția — te ține productiv?","Restaurantul — rapid sau lent?","Comanda curentă — va interfera?","Întoarcerea — unde termini?","Valoarea pe oră — total ÷ timp"], p:["Dacă noua comandă strică toată ruta, refuz-o."]},
  {h:"14. Exemplu — acceptă", p:["Ai £8 de la Deliveroo, mâncarea în 5 minute, livrare spre nord. Apare £7 de la Uber: restaurant la 500 m, livrare tot spre nord."], ul:["Aceeași direcție","Distanță suplimentară mică","Ambele se ridică repede","Venit suplimentar real"], note:"Combinație bună. Acceptă."},
  {h:"15. Exemplu — refuză", p:["Ai £9 de la Just Eat, mâncarea aproape gata, livrare spre est. Apare £6 de la Uber: restaurant la 2 mile vest, bucătărie lentă, client și mai la vest."], ul:["Condus în plus","Așteptare în plus","Direcție greșită","Pune în pericol comanda de £9"], note:"Refuză."},
  {h:"16. Cunoașterea restaurantelor e un capital", p:["După destule livrări îți construiești propria bază: care bucătării sunt rapide, care lente, care încetinesc la anumite ore."], note:"Această cunoaștere valorează adesea mai mult decât suma de pe ecran."},
  {h:"17. Transformă memoria în date", p:["Memoria te înșală. Notează restaurantul, ora, minutele de așteptare, platforma, ziua și dacă era aglomerat."], p2:["O bucătărie verde la ora 15 poate fi roșie la 19."]},
  {h:"18. Cum te ajută aplicația", p:["Stack Check răspunde la o singură întrebare: pot adăuga această comandă fără să-mi distrug ruta actuală?"], p2:["CHECK → ADAUGĂ COMANDĂ → CONDU. Combină ruta, distanța, timpii, așteptarea și comenzile pe care le ai deja."], note:"Nu decide în locul tău — îți pune rapid faptele importante în față."},
  {h:"19. Șapte greșeli frecvente", ul:["Goana după sumă — £15 nu e automat bine","Ignorarea bucătăriei","Ignorarea direcției","Prea multe combinații","Numărarea doar a milelor","Uitarea drumului de întoarcere","Gândirea costului scufundat"]},
  {h:"20. Formula de bază", p:["Valoare reală = plata − costul timpului − distanța suplimentară − riscul de așteptare."], p2:["Valoarea combinației = plata suplimentară − timpul suplimentar − distanța suplimentară − riscul de întârziere."], note:"Nu ai nevoie de calcule perfecte, ci de decizii consecvente."},
  {h:"21. Fișă rapidă", ul:["VERDE — plată bună, așteptare scurtă, aceeași direcție. De obicei acceptă.","PORTOCALIU — calculează întâi.","ROȘU — așteptare lungă, direcție greșită, ocol mare, risc pentru comanda curentă. De obicei refuză."]},
  {h:"22. Obiectivul real", p:["Nu cele mai multe livrări, ci cel mai mare £/oră sustenabil, cu risc controlat."], p2:["Un curier cu 25 de comenzi prost alese poate câștiga mai puțin decât unul cu 18 bine plasate."], note:"O comandă bună îmbunătățește toată tura, nu doar următoarele zece minute."},
]};

const ES = { title:"APRENDE", subtitle:"Trabajar con varias apps — cómo ganar más por hora", sections:[
  {h:"1. Qué es trabajar con varias apps", p:["Trabajar en más de una plataforma a la vez — Uber Eats, Deliveroo y Just Eat."], note:"El objetivo no es el mayor número de pedidos, sino el mayor ingreso por hora, con la distancia, la espera y el riesgo bajo control."},
  {h:"2. Cada pedido tiene cinco valores", ul:["Pago","Distancia","Tiempo real","Dirección — dónde te deja","Riesgo de espera"], p:["El pedido mejor pagado no es automáticamente el mejor.","£8 / 2 millas / 20 min supera a £10 / 6 millas / 40 min."]},
  {h:"3. Protege tu tiempo", p:["El mayor coste no es el combustible, es el tiempo muerto: ir a por comida que no está lista, esperar, volver a la zona activa y estar parado."], p2:["£30 en una hora son £30/hora. Los mismos £30 en hora y media son £20/hora."], note:"El mismo dinero es un buen o mal turno — solo lo decide el reloj."},
  {h:"4. Leer el tiempo de espera", p:["La espera es la mayor diferencia entre un turno rentable y uno malo."], ul:["Verde — espera corta y previsible. Buena para juntar pedidos.","Naranja — moderada. Acepta con cuidado.","Rojo — larga o impredecible. Normalmente no juntes."], p2:["En la app: verde por debajo de 45 minutos, naranja 45–60, rojo más de una hora."]},
  {h:"5. Juntar pedidos", p:["Juntar es coger dos pedidos que de verdad caben en el mismo viaje."], note:"Pregunta: ¿puedo hacer los dos sin retrasar mucho al primer cliente? Y no: dos pedidos es el doble de dinero."},
  {h:"6. Buena combinación", ul:["£7 de Uber y £6 de Deliveroo","Restaurantes cerca","Entregas en la misma dirección","Ambas cocinas normalmente rápidas"], p:["£13 en total. Si el segundo solo añade 10–15 minutos, es excelente."]},
  {h:"7. Mala combinación", ul:["Ya tienes £8","El nuevo paga £6","Su restaurante está a 3 millas en dirección contraria","Cocina con historial de esperas largas"], p:["Los £6 pueden destruir el valor de los £8. Normalmente, recházalo."]},
  {h:"8. La dirección importa más que la distancia", p:["Tres millas en la dirección correcta valen más que una en la equivocada."], p2:["Vas hacia el norte. A: 3 millas al norte por £7. B: 1 milla al sur por £6. A suele ser mejor — tras B vuelves vacío, y las millas vacías son tiempo no pagado."]},
  {h:"9. El coste oculto de salir de tu zona", p:["£10 por 5 millas parece bien. Pero acabas a 5 millas de los restaurantes y vuelves 4 millas sin nada."], note:"Movimiento real: 9 millas. Pregunta siempre dónde te deja el pedido."},
  {h:"10. La demanda no es igual en cada app", p:["La fuerza de cada plataforma cambia. Patrones a observar:"], ul:["Uber suele ser fuerte los domingos","Just Eat suele ser fuerte los sábados","Tardes y noches más densas","Alrededor de 16:00–18:00 un periodo clave"], p2:["La mejor plataforma cambia con el día, la hora, la zona, el restaurante, el tiempo, la demanda y el número de repartidores."]},
  {h:"11. La trampa del «pedido bueno»", p:["£12 parece excelente. Luego: 10 min hasta el restaurante, 20 esperando, 30 conduciendo, 10 volviendo. Son 70 minutos — menos de £10/hora."], note:"Juzga siempre: pago ÷ tiempo total realista."},
  {h:"12. Cómo es un buen resultado", p:["Un turno registrado: £134,69 en 5 horas con 16 pedidos — £26,94/hora."], p2:["Referencias: £25–£30/hora normalmente, £35–£40 en fines de semana fuertes, unos £1.338 en 45–50 horas."], note:"Funciona cuando las plataformas rellenan los huecos de las otras en vez de competir por tu tiempo."},
  {h:"13. Siete comprobaciones antes de aceptar", ul:["Pago — ¿merece el tiempo?","Distancia — ¿cuántas millas?","Dirección — ¿te mantiene productivo?","Restaurante — ¿rápido o lento?","Pedido actual — ¿interferirá?","Regreso — ¿dónde terminas?","Valor por hora — total ÷ tiempo"], p:["Si el nuevo pedido estropea toda la ruta, recházalo."]},
  {h:"14. Ejemplo — aceptar", p:["Tienes £8 de Deliveroo, comida en 5 minutos, entrega al norte. Aparece £7 de Uber: restaurante a 500 m, entrega también al norte."], ul:["Misma dirección","Distancia extra mínima","Ambos se recogen rápido","Ingreso extra real"], note:"Buena combinación. Acéptalo."},
  {h:"15. Ejemplo — rechazar", p:["Tienes £9 de Just Eat, comida casi lista, entrega al este. Aparece £6 de Uber: restaurante a 2 millas al oeste, cocina lenta, cliente aún más al oeste."], ul:["Más conducción","Más espera","Dirección equivocada","Pone en riesgo los £9"], note:"Recházalo."},
  {h:"16. Conocer los restaurantes es un activo", p:["Con suficientes entregas construyes tu propia base: qué cocinas son rápidas, cuáles lentas, cuáles se ralentizan a ciertas horas."], note:"Ese conocimiento suele valer más que la cifra en pantalla."},
  {h:"17. Convierte la memoria en datos", p:["La memoria falla. Anota restaurante, hora, minutos de espera, plataforma, día y si había mucho movimiento."], p2:["Una cocina verde a las 15:00 puede ser roja a las 19:00."]},
  {h:"18. Cómo ayuda esta app", p:["Stack Check responde a una pregunta: ¿puedo añadir este pedido sin destrozar la ruta que ya tengo?"], p2:["CHECK → AÑADIR PEDIDO → CONDUCIR. Combina ruta, distancia, tiempos, espera y los pedidos que ya llevas."], note:"No decide por ti — te pone los datos importantes delante rápido."},
  {h:"19. Siete errores comunes", ul:["Perseguir la cifra — £15 no es automáticamente bueno","Ignorar la cocina","Ignorar la dirección","Juntar demasiados pedidos","Contar solo millas","Olvidar el regreso","Pensamiento de coste hundido"]},
  {h:"20. La fórmula central", p:["Valor real = pago − coste de tiempo − distancia extra − riesgo de espera."], p2:["Valor de la combinación = pago extra − tiempo extra − distancia extra − riesgo de retraso."], note:"No necesitas cálculos perfectos. Necesitas decisiones consistentes."},
  {h:"21. Chuleta rápida", ul:["VERDE — buen pago, espera corta, misma dirección. Normalmente acepta.","NARANJA — calcula primero.","ROJO — espera larga, dirección equivocada, gran desvío, riesgo para el pedido actual. Normalmente rechaza."]},
  {h:"22. El objetivo real", p:["No el mayor número de entregas, sino el £/hora sostenible más alto con riesgo controlado."], p2:["Un repartidor con 25 pedidos mal elegidos puede ganar menos que otro con 18 bien colocados."], note:"Un buen pedido mejora todo el turno, no solo los próximos diez minutos."},
]};

const RU = { title:"ОБУЧЕНИЕ", subtitle:"Работа в нескольких приложениях — как зарабатывать больше в час", sections:[
  {h:"1. Что такое мультиаппинг", p:["Работа одновременно на нескольких платформах — Uber Eats, Deliveroo и Just Eat."], note:"Цель — не наибольшее число заказов, а наибольший доход в час при контроле расстояния, ожидания и риска."},
  {h:"2. У каждого заказа пять параметров", ul:["Оплата","Расстояние","Реальное время","Направление — куда вас приведёт","Риск ожидания"], p:["Самый дорогой заказ не обязательно лучший.","£8 / 2 мили / 20 мин лучше, чем £10 / 6 миль / 40 мин."]},
  {h:"3. Берегите своё время", p:["Главные затраты — не бензин, а простой: поездка за неготовой едой, ожидание, возврат в активную зону и простой без заказов."], p2:["£30 за час — это £30/час. Те же £30 за полтора часа — уже £20/час."], note:"Одни и те же деньги делают смену хорошей или плохой — решают только часы."},
  {h:"4. Как читать время ожидания", p:["Ожидание — крупнейшая разница между прибыльной и убыточной сменой."], ul:["Зелёный — короткое, предсказуемое. Хорошо для объединения.","Оранжевый — среднее. Берите осторожно.","Красный — долгое или непредсказуемое. Обычно не объединяйте."], p2:["В приложении: зелёный — менее 45 минут, оранжевый — 45–60, красный — более часа."]},
  {h:"5. Объединение заказов", p:["Объединение — это два заказа, которые действительно укладываются в одну поездку."], note:"Спросите: смогу ли я выполнить оба, не задержав сильно первого клиента? А не: два заказа — двойные деньги."},
  {h:"6. Хорошее объединение", ul:["£7 Uber и £6 Deliveroo","Рестораны рядом","Доставка в одном направлении","Обе кухни обычно быстрые"], p:["Итого £13. Если второй добавляет лишь 10–15 минут — отличное объединение."]},
  {h:"7. Плохое объединение", ul:["У вас уже £8","Новый — £6","Его ресторан в 3 милях в обратную сторону","Кухня известна долгим ожиданием"], p:["£6 могут уничтожить ценность £8. Обычно следует отказаться."]},
  {h:"8. Направление важнее расстояния", p:["Три мили в нужную сторону лучше одной мили не туда."], p2:["Вы едете на север. A: 3 мили на север за £7. B: 1 миля на юг за £6. Обычно A лучше — после B возвращаться пустым, а пустые мили — неоплачиваемое время."]},
  {h:"9. Скрытая цена выезда из зоны", p:["£10 за 5 миль выглядят неплохо. Но вы заканчиваете в 5 милях от ресторанов и возвращаетесь 4 мили пустым."], note:"Реальное перемещение: 9 миль. Всегда спрашивайте, где заказ вас оставит."},
  {h:"10. Спрос неодинаков в разных приложениях", p:["Сила платформ меняется. Закономерности, за которыми стоит следить:"], ul:["Uber часто силён по воскресеньям","Just Eat часто силён по субботам","Вечер и ночь обычно плотнее","Примерно 16:00–18:00 — важный период"], p2:["Лучшая платформа зависит от дня, времени, района, ресторана, погоды, спроса и числа курьеров."]},
  {h:"11. Ловушка «одного хорошего заказа»", p:["£12 выглядят отлично. Затем: 10 минут до ресторана, 20 ожидания, 30 в пути, 10 на возврат — итого 70 минут, меньше £10/час."], note:"Всегда считайте: оплата ÷ реальное общее время."},
  {h:"12. Как выглядит хороший результат", p:["Записанная смена: £134,69 за 5 часов, 16 заказов — £26,94/час."], p2:["Ориентиры: обычно £25–£30/час, £35–£40 в сильные выходные, около £1338 за 45–50 часов."], note:"Мультиаппинг работает, когда платформы закрывают паузы друг друга, а не спорят за ваше время."},
  {h:"13. Семь проверок перед принятием", ul:["Оплата — стоит ли времени?","Расстояние — сколько миль?","Направление — оставит ли в рабочей зоне?","Ресторан — быстрый или медленный?","Текущий заказ — не помешает ли?","Возврат — где закончите?","Ценность в час — сумма ÷ время"], p:["Если новый заказ портит весь маршрут — откажитесь."]},
  {h:"14. Пример — принять", p:["У вас £8 Deliveroo, еда через 5 минут, доставка на север. Появляется £7 Uber: ресторан в 500 м, доставка тоже на север."], ul:["То же направление","Минимальное дополнительное расстояние","Оба быстро забираются","Существенный дополнительный доход"], note:"Сильное объединение. Берите."},
  {h:"15. Пример — отказаться", p:["У вас £9 Just Eat, еда почти готова, доставка на восток. Появляется £6 Uber: ресторан в 2 милях на запад, медленная кухня, клиент ещё западнее."], ul:["Лишняя дорога","Лишнее ожидание","Неверное направление","Риск для заказа на £9"], note:"Откажитесь."},
  {h:"16. Знание ресторанов — это капитал", p:["После достаточного числа доставок появляется своя база: какие кухни быстрые, какие медленные, какие тормозят в определённые часы."], note:"Эти знания часто ценнее суммы на экране."},
  {h:"17. Превратите память в данные", p:["Память подводит. Записывайте ресторан, время, минуты ожидания, платформу, день и был ли час пик."], p2:["Кухня, зелёная в 15:00, может быть красной в 19:00."]},
  {h:"18. Чем помогает это приложение", p:["Stack Check отвечает на один вопрос: могу ли я добавить этот заказ, не разрушив текущий маршрут?"], p2:["CHECK → ДОБАВИТЬ ЗАКАЗ → ЕХАТЬ. Оно объединяет маршрут, расстояние, время ожидания и уже принятые заказы."], note:"Оно не решает за вас — оно быстро показывает главное."},
  {h:"19. Семь частых ошибок", ul:["Погоня за суммой — £15 не всегда хорошо","Игнорирование кухни","Игнорирование направления","Слишком много объединений","Учёт только миль","Забытый обратный путь","Мышление невозвратных затрат"]},
  {h:"20. Основная формула", p:["Реальная ценность = оплата − стоимость времени − лишнее расстояние − риск ожидания."], p2:["Ценность объединения = доп. оплата − доп. время − доп. расстояние − риск задержки."], note:"Не нужна идеальная математика — нужны последовательные решения."},
  {h:"21. Быстрая шпаргалка", ul:["ЗЕЛЁНЫЙ — хорошая оплата, короткое ожидание, то же направление. Обычно берите.","ОРАНЖЕВЫЙ — сначала посчитайте.","КРАСНЫЙ — долгое ожидание, неверное направление, большой крюк, риск для текущего заказа. Обычно откажитесь."]},
  {h:"22. Настоящая цель", p:["Не наибольшее число доставок, а наивысший устойчивый £/час при контролируемом риске."], p2:["Курьер с 25 плохо выбранными заказами может заработать меньше, чем с 18 удачными."], note:"Хороший заказ улучшает всю смену, а не только ближайшие десять минут."},
]};

export const LEARN = { en: EN, pl: PL, ar: AR, hi: HI, ur: UR, pt: PT, zh: ZH, ro: RO, es: ES, ru: RU };
