// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { randomUUID } from "node:crypto";
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Locale, NextStep, Service, Urgency } from "@healtrip/contracts";
import { normalizeText, stem, tokenize } from "../common/text.js";
import { resolveCity } from "../directory/query.js";
import type { City } from "../directory/types.js";
import { urgencyRank } from "../triage/triage.js";
import type { ModelClient, ModelReply, ModelRequest } from "./model-client.js";

/**
 * A deterministic stand-in for Claude that speaks the same tool protocol.
 *
 * It exists so the whole pipeline - triage, tool calls, grounding, provider
 * cards - runs without an API key, and so end-to-end tests have a model whose
 * every move is predictable. It reads keywords; it does not understand. The
 * interface labels its answers accordingly.
 */
export class RuleBasedModelClient implements ModelClient {
  readonly engine = "rule-based" as const;

  constructor(private readonly cities: readonly City[]) {}

  async complete(request: ModelRequest): Promise<ModelReply> {
    const transcript = read(request.messages);
    const pending = pendingSearch(request.messages);

    if (pending) {
      if (pending.count === 0 && pending.input.city !== null) {
        return reply([toolUse("search_providers", { ...pending.input, city: null })]);
      }
      return reply([respond(recommendation(pending, transcript))]);
    }

    const text = transcript.patientText;
    const service = pickService(text);
    const city = this.pickCity(text);
    const needsLocation = city === null && service === null && !transcript.askedBefore;
    if (needsLocation) return reply([respond(askForLocation(transcript.locale))]);

    return reply([
      toolUse("search_providers", {
        specialty: pickSpecialty(text),
        city: city?.en ?? null,
        country: null,
        language: pickLanguage(text),
        service,
      }),
    ]);
  }

  private pickCity(text: string): City | null {
    for (const token of tokenize(normalizeText(text))) {
      const city = resolveCity(token, this.cities);
      if (city) return city;
    }
    return null;
  }
}

interface Transcript {
  locale: Locale;
  floor: Urgency | null;
  patientText: string;
  askedBefore: boolean;
}

interface SearchInput {
  specialty: string;
  city: string | null;
  country: string | null;
  language: string | null;
  service: Service | null;
}

interface PendingSearch {
  input: SearchInput;
  count: number;
  ids: string[];
}

const textOf = (content: BetaMessageParam["content"] | undefined): string[] => {
  if (content === undefined) return [];
  if (typeof content === "string") return [content];
  return content.flatMap((block) => (block.type === "text" ? [block.text] : []));
};

function read(messages: BetaMessageParam[]): Transcript {
  const notes = messages.filter((m) => m.role === "system").flatMap((m) => textOf(m.content));
  const note = notes.at(-1) ?? "";
  const floor = /Minimum urgency[^:]*:\s*(\w+)/.exec(note)?.[1] as Urgency | undefined;
  return {
    locale: /\(ar\)/.test(note) ? "ar" : "en",
    floor: floor ?? null,
    patientText: messages
      .filter((m) => m.role === "user")
      .flatMap((m) => textOf(m.content))
      .filter((t) => !t.startsWith("Service:"))
      .join("\n"),
    askedBefore: messages.some(
      (m) =>
        m.role === "assistant" &&
        typeof m.content !== "string" &&
        m.content.some((b) => b.type === "tool_use" && b.name === "respond"),
    ),
  };
}

/** The search this engine asked for last, if the latest message carries its results. */
function pendingSearch(messages: BetaMessageParam[]): PendingSearch | null {
  const last = messages.at(-1);
  const previous = messages.at(-2);
  if (last?.role !== "user" || previous?.role !== "assistant" || typeof last.content === "string")
    return null;
  if (typeof previous.content === "string") return null;
  const call = previous.content.find(
    (b): b is BetaToolUseBlock => b.type === "tool_use" && b.name === "search_providers",
  );
  const result = last.content.find((b) => b.type === "tool_result" && b.tool_use_id === call?.id);
  if (!call || !result || result.type !== "tool_result" || typeof result.content !== "string")
    return null;
  const parsed = JSON.parse(result.content) as {
    count?: number;
    results?: Array<{ provider_id: string }>;
  };
  return {
    input: call.input as SearchInput,
    count: parsed.count ?? 0,
    ids: (parsed.results ?? []).map((r) => r.provider_id),
  };
}

const has = (text: string, words: string[]): number => {
  const stems = new Set(tokenize(normalizeText(text)).map(stem));
  const joined = ` ${tokenize(normalizeText(text)).join(" ")} `;
  return words.filter((w) => {
    const tokens = tokenize(normalizeText(w)).map(stem);
    return tokens.length === 1
      ? stems.has(tokens[0] ?? "")
      : joined.includes(` ${tokens.join(" ")} `);
  }).length;
};

const SPECIALTY_WORDS: Array<[string, string[]]> = [
  [
    "cardiothoracic_surgery",
    ["bypass", "valve", "heart surgery", "open heart", "عملية قلب", "صمام", "قلب مفتوح"],
  ],
  [
    "cardiology",
    [
      "chest",
      "heart",
      "cardiac",
      "palpitations",
      "angina",
      "cardiologist",
      "صدر",
      "قلب",
      "خفقان",
      "ذبحة",
    ],
  ],
  ["pulmonology", ["cough", "asthma", "lung", "lungs", "wheezing", "كحة", "سعال", "ربو", "رئة"]],
  [
    "gastroenterology",
    [
      "stomach",
      "reflux",
      "heartburn",
      "abdominal",
      "bowel",
      "معدة",
      "حموضة",
      "ارتجاع",
      "بطن",
      "قولون",
    ],
  ],
  ["neurology", ["headache", "migraine", "numbness", "seizure", "صداع", "شقيقة", "تنميل", "تشنج"]],
  [
    "orthopedics",
    ["back pain", "knee", "joint", "spine", "bone", "ظهر", "ركبة", "مفصل", "فقرات", "عظم"],
  ],
];

function pickSpecialty(text: string): string {
  let best: [string, number] = ["family_medicine", 0];
  for (const [code, words] of SPECIALTY_WORDS) {
    const score = has(text, words);
    if (score > best[1]) best = [code, score];
  }
  return best[0];
}

function pickService(text: string): Service | null {
  if (
    has(text, ["second opinion", "another opinion", "رأي ثاني", "رأي آخر", "رأي ثان", "رأي اخر"]) >
    0
  ) {
    return "second_opinion";
  }
  if (
    has(text, [
      "online",
      "video",
      "telemedicine",
      "remote",
      "remotely",
      "عن بعد",
      "أونلاين",
      "فيديو",
    ]) > 0
  ) {
    return "telemedicine";
  }
  return null;
}

function pickLanguage(text: string): string | null {
  const arabic = has(text, ["arabic", "عربي", "العربية"]) > 0;
  const english = has(text, ["english", "انجليزي", "الإنجليزية", "إنجليزي"]) > 0;
  if (arabic === english) return null;
  return arabic ? "ar" : "en";
}

const TEXT: Record<Locale, Record<string, string>> = {
  en: {
    ask: "I can help you find the right care. A couple of quick questions first.",
    where: "Which city are you in? Or would a video consultation suit you?",
    language: "Which language would you like your doctor to speak?",
    specialist_visit:
      "From what you describe, the right next step is an assessment by a specialist. These doctors match what you told me.",
    second_opinion:
      "A second opinion from a specialist is a reasonable next step. These doctors review existing results and treatment plans.",
    telemedicine:
      "A video consultation is a good place to start. These doctors can see you online.",
    primary_care: "A general consultation is a sensible first step. These doctors can see you.",
    nothing: "I could not find a match for that in the HealTrip directory.",
    widen: "Would a video consultation, or a doctor in another city, work for you?",
  },
  ar: {
    ask: "يمكنني مساعدتك في الوصول إلى الرعاية المناسبة. لديّ سؤالان سريعان أولًا.",
    where: "في أي مدينة أنت؟ أم تناسبك استشارة عبر الفيديو؟",
    language: "بأي لغة تفضّل أن يتحدث طبيبك؟",
    specialist_visit:
      "بحسب ما وصفته، فالخطوة المناسبة التالية هي تقييم لدى طبيب مختص. هؤلاء الأطباء يناسبون ما ذكرته.",
    second_opinion:
      "الحصول على رأي ثانٍ من طبيب مختص خطوة معقولة. هؤلاء الأطباء يراجعون النتائج والخطط العلاجية القائمة.",
    telemedicine: "الاستشارة عبر الفيديو بداية جيدة. يمكن لهؤلاء الأطباء رؤيتك عن بُعد.",
    primary_care: "الاستشارة العامة خطوة أولى مناسبة. يمكن لهؤلاء الأطباء استقبالك.",
    nothing: "لم أجد ما يطابق طلبك في دليل HealTrip.",
    widen: "هل تناسبك استشارة عبر الفيديو، أو طبيب في مدينة أخرى؟",
  },
};

function askForLocation(locale: Locale) {
  const t = TEXT[locale];
  return {
    kind: "clarify",
    message: t.ask,
    questions: [t.where, t.language],
    next_step: null,
    urgency: null,
    provider_ids: [],
  };
}

function recommendation(search: PendingSearch, transcript: Transcript) {
  const t = TEXT[transcript.locale];
  if (search.count === 0) {
    return {
      kind: "clarify",
      message: t.nothing,
      questions: [t.widen],
      next_step: null,
      urgency: null,
      provider_ids: [],
    };
  }
  const nextStep: Exclude<NextStep, "emergency_services" | "urgent_care"> =
    search.input.service === "second_opinion"
      ? "second_opinion"
      : search.input.service === "telemedicine"
        ? "telemedicine"
        : ["family_medicine", "internal_medicine"].includes(search.input.specialty)
          ? "primary_care"
          : "specialist_visit";
  const base: Urgency = search.input.specialty === "cardiology" ? "within_days" : "routine";
  const floor = transcript.floor;
  const urgency = floor !== null && urgencyRank(floor) > urgencyRank(base) ? floor : base;
  return {
    kind: "recommendation",
    message: t[nextStep] ?? t.specialist_visit,
    questions: [],
    next_step: nextStep,
    urgency,
    provider_ids: search.ids.slice(0, 3),
  };
}

const toolUse = (name: string, input: unknown): BetaToolUseBlock => ({
  type: "tool_use",
  id: `toolu_rb_${randomUUID()}`,
  name,
  input,
});

const respond = (input: unknown): BetaToolUseBlock => toolUse("respond", input);

const reply = (content: BetaContentBlock[]): ModelReply => ({
  content,
  stopReason: "tool_use",
  refusalCategory: null,
  usage: null,
});
