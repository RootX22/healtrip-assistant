// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type { Locale, Urgency } from "@healtrip/contracts";
import { arabicShare, normalizeText, tokenize } from "../common/text.js";
import { urgencyRank } from "../triage/triage.js";
import { type RespondInput, respondInput } from "./tools.js";

export type Verdict = { ok: true; value: RespondInput } | { ok: false; problems: string[] };

export interface GroundingContext {
  /** provider_ids the tools have returned in this conversation. */
  evidence: ReadonlySet<string>;
  floor: Urgency | null;
  locale: Locale;
  names: NameIndex;
}

// Words that say what a place is rather than which place it is. Stripping them
// leaves the distinctive part ("Wadi Hanifa"), which a model might write on its own.
const GENERIC_WORDS = new Set(
  [
    "doctor",
    "hospital",
    "centre",
    "center",
    "medical",
    "city",
    "general",
    "international",
    "university",
    "specialist",
    "institute",
    "clinic",
    "virtual",
    "heart",
    "cardiac",
    "al",
    "مستشفى",
    "مركز",
    "مدينة",
    "معهد",
    "عيادة",
    "العام",
    "الدولي",
    "الجامعي",
    "التخصصي",
    "الطبية",
    "للقلب",
    "الافتراضية",
  ].map((word) => normalizeText(word)),
);

const HONORIFIC_TOKENS = new Set(["dr", "prof", "د"].map((word) => normalizeText(word)));

const phrase = (text: string): string => ` ${tokenize(normalizeText(text)).join(" ")} `;

/** Finds directory names, in either language, inside free text. */
export class NameIndex {
  private readonly phrases: string[];

  constructor(names: readonly string[]) {
    const phrases = new Set<string>();
    for (const name of names) {
      const tokens = tokenize(normalizeText(name)).filter((token) => !HONORIFIC_TOKENS.has(token));
      // "Sara Al-Otaibi" as well as "Dr. Sara Al-Otaibi"; "Wadi Hanifa" as well as the full name.
      phrases.add(` ${tokens.join(" ")} `);
      const distinctive = tokens.filter((token) => !GENERIC_WORDS.has(token));
      if (distinctive.join("").length >= 5) phrases.add(` ${distinctive.join(" ")} `);
    }
    this.phrases = [...phrases];
  }

  mentionsAny(text: string): boolean {
    const haystack = phrase(text);
    return this.phrases.some((p) => haystack.includes(p));
  }
}

const HONORIFIC = [
  /\b(?:Dr|Prof)\.?\s+\p{Lu}/u,
  /(?:^|\s)د\s*\.\s*\S/u,
  // "the doctor <name>"; the indefinite "a doctor" stays allowed.
  /(?:^|\s)الدكتور[ةه]?\s+(?!المختص|المعالج|المناسب|الذي|التي)\S/u,
];
const CONTACT = [/https?:\/\/|www\./i, /[\w.+-]+@[\w-]+\.[\w.]+/, /\+?\d[\d\s-]{7,}\d/];
const PRICE = [
  /\d[\d,.]*\s*(?:sar|aed|egp|try|usd|eur|riyals?|dirhams?|pounds?|lira)\b/i,
  /(?:\b(?:sar|aed|egp|try|usd|eur)|[$€£])\s*\d/i,
  /\d[\d,.]*\s*(?:ريال|ريالا|درهم|جنيه|ليره|دولار)/u,
];

function textProblems(text: string, names: NameIndex): string[] {
  const problems: string[] = [];
  if (names.mentionsAny(text)) problems.push("names a doctor or facility");
  if (HONORIFIC.some((re) => re.test(text))) problems.push("uses a doctor's title with a name");
  // Normalised so that Arabic-Indic digits ("٤٥٠ ريال") are caught like ASCII ones.
  const folded = normalizeText(text);
  if (CONTACT.some((re) => re.test(folded))) problems.push("contains contact details or a link");
  if (PRICE.some((re) => re.test(folded))) problems.push("states a price");
  return problems;
}

/**
 * The last check between the model and the patient. The model chooses; the
 * directory states. Anything that reads like a fact about a provider must come
 * from the card the service renders, never from the model's own words.
 */
export function checkRespond(input: unknown, ctx: GroundingContext): Verdict {
  const parsed = respondInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
      ),
    };
  }
  const answer = parsed.data;
  const problems = [
    ...providerProblems(answer.provider_ids, ctx.evidence),
    ...shapeProblems(answer),
    ...urgencyProblems(answer.urgency, ctx.floor),
    ...wordingProblems(answer, ctx.names),
    ...languageProblems(answer.message, ctx.locale),
  ];
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: answer };
}

function providerProblems(ids: string[], evidence: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (new Set(ids).size !== ids.length) problems.push("provider_ids repeats an id");
  const unknown = ids.filter((id) => !evidence.has(id));
  if (unknown.length > 0) {
    problems.push(
      `provider_ids ${unknown.join(", ")} were not returned by search_providers or get_provider in this conversation`,
    );
  }
  return problems;
}

/** What each kind of answer must and must not carry. */
function shapeProblems(answer: RespondInput): string[] {
  switch (answer.kind) {
    case "clarify":
      return [
        ...(answer.questions.length === 0 ? ["a clarify turn needs at least one question"] : []),
        ...(answer.provider_ids.length > 0
          ? ["ask first and recommend once you have the answer: clarify carries no providers"]
          : []),
      ];
    case "recommendation":
      return [
        ...(answer.next_step === null ? ["a recommendation needs next_step"] : []),
        ...(answer.urgency === null ? ["a recommendation needs urgency"] : []),
      ];
    case "out_of_scope":
      return answer.provider_ids.length > 0 || answer.next_step !== null
        ? ["an out_of_scope turn carries no providers or next_step"]
        : [];
  }
}

function urgencyProblems(urgency: Urgency | null, floor: Urgency | null): string[] {
  if (floor === null || urgency === null || urgencyRank(urgency) >= urgencyRank(floor)) return [];
  return [`urgency must be at least ${floor} for this conversation`];
}

function wordingProblems(answer: RespondInput, names: NameIndex): string[] {
  const texts: Array<[string, string]> = [
    ["message", answer.message],
    ...answer.questions.map((q, i): [string, string] => [`questions[${i}]`, q]),
  ];
  return texts.flatMap(([field, text]) =>
    textProblems(text, names).map((problem) => `${field} ${problem}`),
  );
}

function languageProblems(message: string, locale: Locale): string[] {
  const arabic = arabicShare(message);
  if (locale === "ar" && arabic < 0.5) return ["message must be written in Arabic"];
  if (locale === "en" && arabic > 0.5) return ["message must be written in English"];
  return [];
}
