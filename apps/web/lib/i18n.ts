// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type { Engine, Grounding, Locale, NextStep, TurnKind, Urgency } from "@healtrip/contracts";

export const LOCALES: readonly Locale[] = ["en", "ar"];
export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

const en = {
  title: "HealTrip care assistant",
  tagline: "Describe what is going on and I will help you decide where to go next.",
  disclaimer:
    "This assistant does not diagnose. In an emergency, call 997 or go to the nearest emergency department.",
  placeholder: "Describe your symptoms or what you need…",
  send: "Send",
  sending: "Working on it…",
  newConversation: "New conversation",
  switchLanguage: "العربية",
  you: "You",
  assistant: "HealTrip",
  engine: {
    claude: "Claude",
    "rule-based": "Rule-based demo",
    deterministic: "Safety rules",
  } satisfies Record<Engine, string>,
  engineNotice: "Demo mode: answers come from a rule-based stand-in, not a language model.",
  kind: {
    emergency: "Emergency",
    safety_screen: "Safety check",
    clarify: "A few questions",
    recommendation: "Recommendation",
    out_of_scope: "Outside what I can help with",
    fallback: "Something went wrong",
  } satisfies Record<TurnKind, string>,
  nextStep: {
    emergency_services: "Emergency services now",
    urgent_care: "Urgent care",
    specialist_visit: "Specialist appointment",
    second_opinion: "Second opinion",
    telemedicine: "Video consultation",
    primary_care: "General consultation",
  } satisfies Record<NextStep, string>,
  urgency: {
    immediate: "now",
    within_24_hours: "within 24 hours",
    within_days: "within the next few days",
    routine: "when convenient",
  } satisfies Record<Urgency, string>,
  call: "Call",
  noneApply: "None of these apply",
  someApply: "Submit",
  checklistHint: "Tick everything that applies.",
  card: {
    verified: "From the HealTrip directory",
    years: (n: number) => `${n} years' experience`,
    wait: (n: number) =>
      n === 0 ? "Available today" : `Typically within ${n} day${n === 1 ? "" : "s"}`,
    inPerson: "In person",
    telemedicine: "Video",
    secondOpinion: "Second opinion",
    emergencyDepartment: "Emergency department on site",
    virtual: "Online",
    fee: "Consultation",
    speaks: "Speaks",
  },
  trace: {
    summary: "How this answer was produced",
    engine: "Engine",
    grounding: "Grounding check",
    steps: "Steps",
    outcome: {
      passed: "passed",
      repaired: "passed after correction",
      rejected: "failed: nothing unverified was shown",
      not_applicable: "not needed",
    } satisfies Record<Grounding, string>,
  },
  errors: {
    network: "Could not reach the service. Check your connection and try again.",
    rate_limited: "Too many messages at once. Please wait a moment.",
    turn_in_progress: "Still answering your previous message.",
    conversation_not_found: "This conversation has expired. Start a new one.",
    conversation_limit: "This conversation is full. Start a new one.",
    generic: "Something went wrong. Please try again.",
  } as Record<string, string>,
  reference: "Reference",
  emergencyClosed: "This conversation has been stopped for your safety.",
  answered: { none: "None of these apply.", some: "These apply:" },
};

type Dictionary = typeof en;

/** Arabic counted nouns: one and two have their own forms, 3-10 take the plural, 11+ the singular. */
function arabicCount(
  n: number,
  forms: { one: string; two: string; few: string; many: string },
): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

const DAYS = { one: "يوم واحد", two: "يومين", few: "أيام", many: "يومًا" };
const YEARS = { one: "سنة واحدة", two: "سنتين", few: "سنوات", many: "سنة" };

const ar: Dictionary = {
  title: "مساعد الرعاية من HealTrip",
  tagline: "صِف ما تشعر به، وسأساعدك في تحديد وجهتك التالية.",
  disclaimer:
    "هذا المساعد لا يشخّص الأمراض. في حالات الطوارئ اتصل بالرقم 997 أو توجّه إلى أقرب قسم طوارئ.",
  placeholder: "صِف أعراضك أو ما تحتاج إليه…",
  send: "إرسال",
  sending: "جارٍ العمل…",
  newConversation: "محادثة جديدة",
  switchLanguage: "English",
  you: "أنت",
  assistant: "HealTrip",
  engine: { claude: "Claude", "rule-based": "عرض تجريبي بالقواعد", deterministic: "قواعد السلامة" },
  engineNotice: "وضع تجريبي: الإجابات صادرة عن بديل قائم على القواعد، لا عن نموذج لغوي.",
  kind: {
    emergency: "حالة طارئة",
    safety_screen: "فحص السلامة",
    clarify: "بعض الأسئلة",
    recommendation: "توصية",
    out_of_scope: "خارج ما يمكنني المساعدة فيه",
    fallback: "حدث خطأ",
  },
  nextStep: {
    emergency_services: "خدمات الطوارئ فورًا",
    urgent_care: "رعاية عاجلة",
    specialist_visit: "موعد لدى طبيب مختص",
    second_opinion: "رأي طبي ثانٍ",
    telemedicine: "استشارة عبر الفيديو",
    primary_care: "استشارة عامة",
  },
  urgency: {
    immediate: "الآن",
    within_24_hours: "خلال 24 ساعة",
    within_days: "خلال الأيام القليلة القادمة",
    routine: "في الوقت المناسب لك",
  },
  call: "اتصل",
  noneApply: "لا ينطبق عليّ أيٌّ مما سبق",
  someApply: "إرسال",
  checklistHint: "اختر كل ما ينطبق عليك.",
  card: {
    verified: "من دليل HealTrip",
    years: (n: number) => `خبرة ${arabicCount(n, YEARS)}`,
    wait: (n: number) => (n === 0 ? "متاح اليوم" : `عادةً خلال ${arabicCount(n, DAYS)}`),
    inPerson: "حضوري",
    telemedicine: "فيديو",
    secondOpinion: "رأي ثانٍ",
    emergencyDepartment: "يوجد قسم طوارئ",
    virtual: "عن بُعد",
    fee: "الاستشارة",
    speaks: "يتحدث",
  },
  trace: {
    summary: "كيف أُعدّت هذه الإجابة",
    engine: "المحرك",
    grounding: "فحص المصادر",
    steps: "الخطوات",
    outcome: {
      passed: "ناجح",
      repaired: "ناجح بعد التصحيح",
      rejected: "فشل، ولم يُعرض أي محتوى غير موثّق",
      not_applicable: "غير مطلوب",
    },
  },
  errors: {
    network: "تعذّر الوصول إلى الخدمة. تحقّق من اتصالك وحاول مجددًا.",
    rate_limited: "رسائل كثيرة في وقت قصير. يُرجى الانتظار قليلًا.",
    turn_in_progress: "ما زلت أجيب عن رسالتك السابقة.",
    conversation_not_found: "انتهت صلاحية هذه المحادثة. ابدأ محادثة جديدة.",
    conversation_limit: "اكتملت هذه المحادثة. ابدأ محادثة جديدة.",
    generic: "حدث خطأ ما. يُرجى المحاولة مجددًا.",
  },
  reference: "رقم المرجع",
  emergencyClosed: "أُوقفت هذه المحادثة حرصًا على سلامتك.",
  answered: { none: "لا ينطبق عليّ أيٌّ منها.", some: "ينطبق عليّ:" },
};

export const dictionaries: Record<Locale, Dictionary> = { en, ar };

export const listSeparator = (locale: Locale) => (locale === "ar" ? "، " : ", ");

const LANGUAGE_NAMES: Record<Locale, Record<string, string>> = {
  en: { ar: "Arabic", en: "English", fr: "French", hi: "Hindi", tr: "Turkish", ur: "Urdu" },
  ar: {
    ar: "العربية",
    en: "الإنجليزية",
    fr: "الفرنسية",
    hi: "الهندية",
    tr: "التركية",
    ur: "الأردية",
  },
};
const COUNTRY_NAMES: Record<Locale, Record<string, string>> = {
  en: { SA: "Saudi Arabia", AE: "UAE", EG: "Egypt", TR: "Türkiye" },
  ar: { SA: "السعودية", AE: "الإمارات", EG: "مصر", TR: "تركيا" },
};

export const languageName = (locale: Locale, code: string) => LANGUAGE_NAMES[locale][code] ?? code;
export const countryName = (locale: Locale, code: string) => COUNTRY_NAMES[locale][code] ?? code;

// Western digits in Arabic too, matching every other number on the page.
export const formatFee = (locale: Locale, amount: number, currency: string) =>
  new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
