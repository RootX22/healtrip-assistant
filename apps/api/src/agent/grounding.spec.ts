// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { describe, expect, it } from "vitest";
import { checkRespond, type GroundingContext, NameIndex } from "./grounding.js";
import type { RespondInput } from "./tools.js";
import { InMemoryDirectoryRepository } from "../directory/in-memory-directory.repository.js";

const names = new NameIndex(await new InMemoryDirectoryRepository().listNames());

const ctx = (overrides: Partial<GroundingContext> = {}): GroundingContext => ({
  evidence: new Set(["doc_sara_otaibi", "doc_khalid_harbi"]),
  floor: null,
  locale: "en",
  names,
  ...overrides,
});

const recommendation = (overrides: Partial<RespondInput> = {}): RespondInput => ({
  kind: "recommendation",
  message:
    "A cardiologist should assess this within the next few days. These options fit what you described.",
  questions: [],
  next_step: "specialist_visit",
  urgency: "within_days",
  provider_ids: ["doc_sara_otaibi"],
  ...overrides,
});

const problems = (input: unknown, context = ctx()) => {
  const verdict = checkRespond(input, context);
  return verdict.ok ? [] : verdict.problems;
};

describe("checkRespond", () => {
  it("accepts a recommendation built from returned providers", () => {
    expect(checkRespond(recommendation(), ctx())).toEqual({ ok: true, value: recommendation() });
  });

  it("rejects a provider the tools never returned", () => {
    expect(problems(recommendation({ provider_ids: ["doc_lina_haddad"] }))).toEqual([
      "provider_ids doc_lina_haddad were not returned by search_providers or get_provider in this conversation",
    ]);
  });

  it("rejects an id that exists nowhere", () => {
    expect(problems(recommendation({ provider_ids: ["doc_invented"] }))[0]).toMatch(/doc_invented/);
  });

  it("rejects a repeated id", () => {
    expect(
      problems(recommendation({ provider_ids: ["doc_sara_otaibi", "doc_sara_otaibi"] })),
    ).toContain("provider_ids repeats an id");
  });

  it("holds the urgency floor", () => {
    expect(problems(recommendation({ urgency: "routine" }), ctx({ floor: "within_days" }))).toEqual(
      ["urgency must be at least within_days for this conversation"],
    );
    expect(
      problems(recommendation({ urgency: "within_24_hours" }), ctx({ floor: "within_days" })),
    ).toEqual([]);
  });

  it("requires a next step and urgency on a recommendation", () => {
    expect(problems(recommendation({ next_step: null, urgency: null }))).toEqual([
      "a recommendation needs next_step",
      "a recommendation needs urgency",
    ]);
  });

  it("keeps clarify turns to questions", () => {
    expect(problems(recommendation({ kind: "clarify", questions: [] }))).toContain(
      "a clarify turn needs at least one question",
    );
    expect(
      problems(recommendation({ kind: "clarify", questions: ["Which city are you in?"] })),
    ).toContain("ask first and recommend once you have the answer: clarify carries no providers");
  });

  it.each([
    ["Dr. Sara Al-Otaibi can see you in three days.", "uses a doctor's title with a name"],
    ["Sara Al-Otaibi can see you soon.", "names a doctor or facility"],
    ["Wadi Hanifa has an emergency department.", "names a doctor or facility"],
    ["Her clinic is at https://example.com", "contains contact details or a link"],
    ["Call +966 11 555 0100 to book.", "contains contact details or a link"],
    ["The consultation costs 450 SAR.", "states a price"],
  ])("rejects provider facts in the message: %s", (message, problem) => {
    expect(problems(recommendation({ message }))).toContain(`message ${problem}`);
  });

  it.each([
    ["د. سارة العتيبي متاحة خلال ثلاثة أيام.", "uses a doctor's title with a name"],
    ["الدكتورة سارة العتيبي متاحة قريبًا.", "uses a doctor's title with a name"],
    ["يوجد قسم طوارئ في مستشفى وادي حنيفة.", "names a doctor or facility"],
    ["تكلفة الاستشارة ٤٥٠ ريال.", "states a price"],
  ])("rejects provider facts in Arabic: %s", (message, problem) => {
    expect(problems(recommendation({ message }), ctx({ locale: "ar" }))).toContain(
      `message ${problem}`,
    );
  });

  it.each([
    ["en", "You should see a doctor who specialises in the heart this week."],
    ["ar", "من الأفضل أن يقيّمك طبيب قلب خلال الأيام القادمة، وهذه خيارات مناسبة."],
    ["ar", "أنصحك بزيارة دكتور قلب خلال هذا الأسبوع."],
  ] as const)("allows talking about doctors in general (%s)", (locale, message) => {
    expect(problems(recommendation({ message }), ctx({ locale }))).toEqual([]);
  });

  it("checks clarifying questions as well as the message", () => {
    expect(
      problems(
        recommendation({
          kind: "clarify",
          provider_ids: [],
          questions: ["Would Dr. Khalid suit you?"],
        }),
      ),
    ).toContain("questions[0] uses a doctor's title with a name");
  });

  it("requires the reply in the patient's language", () => {
    expect(problems(recommendation(), ctx({ locale: "ar" }))).toContain(
      "message must be written in Arabic",
    );
  });

  it("reports schema violations as fixable problems", () => {
    expect(problems({ kind: "recommendation" })[0]).toMatch(/^message:/);
    expect(problems(recommendation({ provider_ids: ["a", "b", "c", "d"] }))[0]).toMatch(
      /^provider_ids:/,
    );
  });
});
