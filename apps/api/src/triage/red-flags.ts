// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { normalizeText, splitClauses, stem, tokenize } from "../common/text.js";
import {
  type Concept,
  LEXICON,
  MA_NEGATES_BEFORE,
  NEGATION_CUES,
  NEGATION_WINDOW,
  PSEUDO_NEGATION_FOLLOWERS,
} from "./lexicon.js";

export type RedFlag =
  | "cardiac"
  | "heart_attack"
  | "breathing"
  | "unconscious"
  | "stroke"
  | "bleeding"
  | "self_harm"
  | "anaphylaxis"
  | "headache";

export type SymptomFamily = "chest_pain";

export interface Detection {
  redFlags: RedFlag[];
  families: SymptomFamily[];
  /** A warning sign that turns chest pain into an emergency, whenever the chest pain was mentioned. */
  cardiacWarningSign: boolean;
}

const STANDALONE_FLAGS: Array<[Concept, RedFlag]> = [
  ["heart_attack", "heart_attack"],
  ["severe_breathing", "breathing"],
  ["fainted", "unconscious"],
  ["stroke", "stroke"],
  ["severe_bleeding", "bleeding"],
  ["self_harm", "self_harm"],
  ["anaphylaxis", "anaphylaxis"],
  ["thunderclap_headache", "headache"],
];

const CARDIAC_WARNING_SIGNS: Concept[] = [
  "breathless",
  "radiating",
  "sweating",
  "nausea",
  "dizzy",
  "crushing",
  "sudden_or_at_rest",
];

/** How close "chest" and "pain" must be to count as one complaint, in tokens. */
const CHEST_PAIN_SPAN = 3;
/** Tokens a multi-word phrase may skip between its words: "pain in my chest", "ضيق في التنفس". */
const PHRASE_GAP = 2;

const compile = (phrase: string): string[] => tokenize(normalizeText(phrase)).map(stem);
const PHRASES = Object.fromEntries(
  Object.entries(LEXICON).map(([concept, phrases]) => [concept, phrases.map(compile)]),
) as Record<Concept, string[][]>;

const NEGATORS = new Set(NEGATION_CUES.map((cue) => normalizeText(cue)));
const PSEUDO = new Set(PSEUDO_NEGATION_FOLLOWERS.map((word) => stem(normalizeText(word))));
const MA_FOLLOWERS = new Set(MA_NEGATES_BEFORE.map((word) => stem(normalizeText(word))));
// «وما» is «ما» with a conjunction attached and is just as ambiguous.
const MA_FORMS = new Set(["ما", "وما"].map((form) => normalizeText(form)));

interface Clause {
  tokens: string[];
  stems: string[];
}

interface Span {
  start: number;
  end: number;
}

/** Start and end of every occurrence of `phrase`, allowing short gaps between its words. */
function findPhrase(stems: string[], phrase: string[]): Span[] {
  const spans: Span[] = [];
  for (let start = 0; start < stems.length; start += 1) {
    if (stems[start] !== phrase[0]) continue;
    let cursor = start;
    let matched = true;
    for (let k = 1; k < phrase.length && matched; k += 1) {
      const limit = Math.min(stems.length - 1, cursor + 1 + PHRASE_GAP);
      let next = -1;
      for (let j = cursor + 1; j <= limit; j += 1) {
        if (stems[j] === phrase[k]) {
          next = j;
          break;
        }
      }
      if (next === -1) matched = false;
      else cursor = next;
    }
    if (matched) spans.push({ start, end: cursor });
  }
  return spans;
}

function isNegationCue(clause: Clause, index: number): boolean {
  const token = clause.tokens[index];
  if (token === undefined || !NEGATORS.has(token)) return false;
  const following = clause.stems[index + 1];
  if (following !== undefined && PSEUDO.has(following)) return false;
  if (MA_FORMS.has(token)) return following !== undefined && MA_FOLLOWERS.has(following);
  return true;
}

function isNegated(clause: Clause, start: number): boolean {
  for (let i = Math.max(0, start - NEGATION_WINDOW); i < start; i += 1) {
    if (isNegationCue(clause, i)) return true;
  }
  return false;
}

/** Whether the concept appears anywhere in the text without being negated. */
function affirmed(clauses: Clause[], concept: Concept): boolean {
  return clauses.some((clause) =>
    PHRASES[concept].some((phrase) =>
      findPhrase(clause.stems, phrase).some((span) => !isNegated(clause, span.start)),
    ),
  );
}

function affirmedPositions(clause: Clause, concept: Concept): number[] {
  return PHRASES[concept].flatMap((phrase) =>
    findPhrase(clause.stems, phrase)
      .filter((span) => !isNegated(clause, span.start))
      .map((span) => span.start),
  );
}

function mentionsChestPain(clauses: Clause[]): boolean {
  if (affirmed(clauses, "chest_pain_phrase")) return true;
  return clauses.some((clause) => {
    const chest = affirmedPositions(clause, "chest");
    const pain = affirmedPositions(clause, "pain");
    return chest.some((c) => pain.some((p) => Math.abs(c - p) <= CHEST_PAIN_SPAN));
  });
}

/**
 * Finds emergency warning signs and symptom families in one message.
 *
 * Deterministic on purpose: the same words always produce the same decision,
 * every rule is a line in the lexicon a clinician can review, and the model
 * is never asked whether something is an emergency.
 */
export function detect(text: string): Detection {
  const clauses: Clause[] = splitClauses(normalizeText(text)).map((raw) => {
    const tokens = tokenize(raw);
    return { tokens, stems: tokens.map(stem) };
  });

  const redFlags = STANDALONE_FLAGS.filter(([concept]) => affirmed(clauses, concept)).map(
    ([, flag]) => flag,
  );
  const chestPain = mentionsChestPain(clauses);
  const cardiacWarningSign = CARDIAC_WARNING_SIGNS.some((concept) => affirmed(clauses, concept));
  if (chestPain && cardiacWarningSign) redFlags.push("cardiac");

  return {
    redFlags,
    families: chestPain ? ["chest_pain"] : [],
    cardiacWarningSign,
  };
}
