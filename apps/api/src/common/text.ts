// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

/**
 * Text handling shared by triage and grounding: both need Arabic and English
 * matched the way patients actually type them, not the way a dictionary spells
 * them.
 */

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const HAS_ARABIC = /\p{Script=Arabic}/u;

/**
 * Lower-cases, strips diacritics and tatweel, folds the Arabic letter variants
 * people use interchangeably (hamza seats, alef maqsura, taa marbuta) and maps
 * Arabic-Indic digits to ASCII. The output is for matching only, never display.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[‘’ʼ`´]/g, "'");
}

// Negation never reaches across these: "no fever, but my chest is crushing".
const CLAUSE_BREAK =
  /[.!?;؟؛\n]+|\b(?:but|however|although|though|except)\b|(?<!\p{L})(?:لكن|لكنه|لكنها|بس|الا)(?!\p{L})/u;

export function splitClauses(normalized: string): string[] {
  return normalized
    .split(new RegExp(CLAUSE_BREAK.source, "gu"))
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

export function tokenize(clause: string): string[] {
  return clause.split(/[^\p{L}\p{N}']+/u).filter((token) => token.length > 0);
}

// Longest first. Attached prepositions and pronouns turn "صدري" (my chest)
// and "بصدري" (in my chest) into different words; stripping them lets one
// lexicon entry cover all of them.
const ARABIC_PREFIXES = ["وبال", "وال", "بال", "فال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك"];
const ARABIC_SUFFIXES = ["هما", "كما", "ها", "هم", "كم", "هن", "نا", "ني", "ي", "ه", "ك"];
const MIN_STEM = 3;

export function stem(token: string): string {
  if (!HAS_ARABIC.test(token)) return token;
  let result = token;
  const prefix = ARABIC_PREFIXES.find(
    (p) => result.startsWith(p) && result.length - p.length >= MIN_STEM,
  );
  if (prefix) result = result.slice(prefix.length);
  const suffix = ARABIC_SUFFIXES.find(
    (s) => result.endsWith(s) && result.length - s.length >= MIN_STEM,
  );
  if (suffix) result = result.slice(0, -suffix.length);
  return result;
}

export function arabicShare(text: string): number {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length === 0) return 0;
  return letters.filter((ch) => HAS_ARABIC.test(ch)).length / letters.length;
}
