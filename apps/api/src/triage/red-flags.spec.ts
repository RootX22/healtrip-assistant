// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { describe, expect, it } from "vitest";
import { detect } from "./red-flags.js";

describe("detect: emergencies", () => {
  it.each([
    ["I have crushing chest pain going down my left arm", "cardiac"],
    ["chest pain and I'm sweating a lot", "cardiac"],
    ["No fever, but the pain in my chest is crushing", "cardiac"],
    ["not sure if it spreads to my arm, but my chest hurts", "cardiac"],
    ["I can't breathe", "breathing"],
    ["I think I'm having a heart attack", "heart_attack"],
    ["my face is drooping and my speech is slurred", "stroke"],
    ["I want to kill myself", "self_harm"],
    ["this is the worst headache of my life", "headache"],
    ["my throat is closing after I ate peanuts", "anaphylaxis"],
    ["I passed out at work an hour ago", "unconscious"],
    ["عندي ألم شديد في صدري يمتد إلى ذراعي اليسرى", "cardiac"],
    ["ألم في الصدر مع تعرق وغثيان", "cardiac"],
    ["ما أقدر أتنفس", "breathing"],
    ["أبغى أموت", "self_harm"],
    ["أغمي علي قبل ساعة", "unconscious"],
    ["وجهي مايل وعندي صعوبة في الكلام", "stroke"],
  ])("%s -> %s", (text, flag) => {
    expect(detect(text).redFlags).toContain(flag);
  });
});

describe("detect: chest pain without warning signs", () => {
  it.each([
    "I have chest pain and I'm not sure whether I should see a cardiologist, go to the ER, or seek a second opinion.",
    "عندي ألم في الصدر ومش عارف أروح لدكتور قلب ولا الطوارئ ولا آخذ رأي ثاني",
    "my chest hurts when I climb stairs",
    "صدري يوجعني لما أطلع الدرج",
    "I don't know why my chest hurts",
    "ما سبب ألم الصدر؟",
  ])("%s", (text) => {
    const result = detect(text);
    expect(result.families).toEqual(["chest_pain"]);
    expect(result.redFlags).toEqual([]);
  });
});

describe("detect: negation", () => {
  it("does not read a list of denied symptoms as warning signs", () => {
    const result = detect(
      "No, it doesn't spread to my arm, I'm not short of breath and I'm not sweating",
    );
    expect(result.cardiacWarningSign).toBe(false);
    expect(result.redFlags).toEqual([]);
  });

  it("handles the same answer in Gulf Arabic", () => {
    const result = detect("مافي ضيق تنفس ولا تعرق، والألم خفيف");
    expect(result.cardiacWarningSign).toBe(false);
  });

  it("does not find chest pain the patient says they do not have", () => {
    expect(detect("I don't have chest pain, just a headache").families).toEqual([]);
    expect(detect("ما عندي ألم في الصدر").families).toEqual([]);
  });

  it("treats uncertainty as a yes", () => {
    expect(detect("my chest hurts and maybe I'm a bit dizzy").redFlags).toContain("cardiac");
  });

  it("does not let a negation cross into the next sentence", () => {
    expect(detect("I'm not dizzy. I can't breathe properly.").redFlags).toContain("breathing");
  });
});

describe("detect: unrelated text", () => {
  it.each(["I need a dermatologist for a rash", "أبحث عن طبيب أسنان في جدة", "hello"])(
    "%s",
    (text) => {
      expect(detect(text)).toEqual({ redFlags: [], families: [], cardiacWarningSign: false });
    },
  );
});
