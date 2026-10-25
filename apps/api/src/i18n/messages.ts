import type { Locale } from "@healtrip/contracts";

/**
 * Every sentence the service says without the model. Safety wording is fixed
 * text reviewed once, not generated per conversation.
 */
type Localized = Record<Locale, string>;

export const EMERGENCY_LABEL: Localized = {
  en: "Saudi Red Crescent ambulance",
  ar: "إسعاف هيئة الهلال الأحمر السعودي",
};

export type EmergencyWording = "general" | "self_harm";

export function emergencyMessage(
  locale: Locale,
  number: string,
  wording: EmergencyWording,
): string {
  if (wording === "self_harm") {
    return locale === "ar"
      ? `إذا كنت تفكر في إيذاء نفسك أو إنهاء حياتك، فاتصل الآن بالرقم ${number} أو توجّه إلى أقرب قسم طوارئ. لست وحدك، والمساعدة متاحة الآن.`
      : `If you are thinking about harming yourself or ending your life, call ${number} now or go to the nearest emergency department. You are not alone, and help is available right now.`;
  }
  return locale === "ar"
    ? `ما وصفته قد يكون حالة طبية طارئة. اتصل الآن بالرقم ${number} أو توجّه إلى أقرب قسم طوارئ، ولا تقُد السيارة بنفسك. إن كان معك أحد فاطلب منه البقاء بجانبك.`
    : `What you describe could be a medical emergency. Call ${number} now or go to the nearest emergency department, and do not drive yourself. If someone is with you, ask them to stay with you.`;
}

export const EMERGENCY_STICKY_NOTE: Localized = {
  en: "This conversation was stopped because of a possible emergency. If you are safe now and want to plan follow-up care, start a new conversation.",
  ar: "توقفت هذه المحادثة بسبب حالة طارئة محتملة. إن كنت بخير الآن وتريد ترتيب المتابعة، فابدأ محادثة جديدة.",
};

export interface ScreenItem {
  id: string;
  label: Localized;
}

export interface ScreenDefinition {
  id: "chest_pain";
  message: Localized;
  prompt: Localized;
  items: ScreenItem[];
}

export const CHEST_PAIN_SCREEN: ScreenDefinition = {
  id: "chest_pain",
  message: {
    en: "Chest pain needs a quick safety check before anything else. If you feel very unwell, call the emergency number now instead of answering.",
    ar: "ألم الصدر يحتاج إلى فحص سلامة سريع قبل أي شيء آخر. إن كنت تشعر بتعب شديد فاتصل برقم الطوارئ الآن بدل الإجابة.",
  },
  prompt: {
    en: "Do any of these apply to you right now?",
    ar: "هل ينطبق عليك أيٌّ مما يلي الآن؟",
  },
  items: [
    {
      id: "radiating",
      label: {
        en: "The pain spreads to your arm, jaw, neck, back or shoulder",
        ar: "الألم يمتد إلى الذراع أو الفك أو الرقبة أو الظهر أو الكتف",
      },
    },
    {
      id: "breathless",
      label: { en: "You are short of breath", ar: "تشعر بضيق في التنفس" },
    },
    {
      id: "sweating_nausea",
      label: {
        en: "You are sweating, feel sick or have vomited",
        ar: "تتعرّق أو تشعر بالغثيان أو تقيّأت",
      },
    },
    {
      id: "faint",
      label: {
        en: "You feel faint or dizzy, or have passed out",
        ar: "تشعر بدوار أو إغماء، أو فقدت الوعي",
      },
    },
    {
      id: "severe",
      label: {
        en: "The pain is severe, crushing or feels like a heavy weight",
        ar: "الألم شديد أو ضاغط أو كأنه ثقل على الصدر",
      },
    },
    {
      id: "ongoing",
      label: {
        en: "It started within the last hour, or it is happening now while you rest",
        ar: "بدأ خلال الساعة الماضية، أو يحدث الآن وأنت في راحة",
      },
    },
  ],
};

export const SCREEN_STILL_PENDING: Localized = {
  en: "Before I can help with next steps, please answer the safety questions below.",
  ar: "قبل أن أساعدك في الخطوة التالية، يُرجى الإجابة عن أسئلة السلامة أدناه.",
};

export type FallbackReason = "model_unavailable" | "grounding_failed" | "incomplete";

export function fallbackMessage(locale: Locale, reason: FallbackReason, number: string): string {
  const lead: Record<FallbackReason, Localized> = {
    model_unavailable: {
      en: "The assistant is temporarily unavailable.",
      ar: "المساعد غير متاح مؤقتًا.",
    },
    grounding_failed: {
      en: "I could not put together a recommendation I can stand behind from our directory.",
      ar: "لم أتمكن من تقديم توصية موثوقة من دليلنا.",
    },
    incomplete: {
      en: "I could not finish working through your request.",
      ar: "لم أتمكن من إكمال معالجة طلبك.",
    },
  };
  const tail: Localized = {
    en: `Please try again in a moment. If your symptoms are severe or getting worse, call ${number} now.`,
    ar: `يُرجى المحاولة بعد قليل. إن كانت أعراضك شديدة أو تزداد سوءًا فاتصل الآن بالرقم ${number}.`,
  };
  return `${lead[reason][locale]} ${tail[locale]}`;
}

export const LANGUAGE_NAME: Localized = { en: "English", ar: "Arabic" };
