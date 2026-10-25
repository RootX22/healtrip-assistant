// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { describe, expect, it } from "vitest";
import { assess, initialTriageState } from "./triage.js";

const CHEST = "I have chest pain and I'm not sure where to go";

describe("assess", () => {
  it("asks the chest pain checklist before anything else", () => {
    const { assessment, state } = assess(initialTriageState(), { text: CHEST });
    expect(assessment).toMatchObject({
      kind: "screen",
      repeat: false,
      screen: { id: "chest_pain" },
    });
    expect(state.screens.chest_pain).toBe("pending");
  });

  it("escalates when any checklist item applies", () => {
    const pending = assess(initialTriageState(), { text: CHEST }).state;
    const { assessment, state } = assess(pending, {
      screening: { id: "chest_pain", positive: ["breathless"] },
    });
    expect(assessment).toEqual({ kind: "emergency", flags: ["cardiac"] });
    expect(state.emergency).toBe(true);
  });

  it("proceeds with a minimum urgency once the checklist is clear", () => {
    const pending = assess(initialTriageState(), { text: CHEST }).state;
    const { assessment } = assess(pending, { screening: { id: "chest_pain", positive: [] } });
    expect(assessment).toEqual({
      kind: "proceed",
      floor: "within_days",
      clearedScreens: ["chest_pain"],
    });
  });

  it("ignores checklist item ids it does not know", () => {
    const pending = assess(initialTriageState(), { text: CHEST }).state;
    const { assessment } = assess(pending, {
      screening: { id: "chest_pain", positive: ["made_up"] },
    });
    expect(assessment.kind).toBe("proceed");
  });

  it("asks again when the patient replies with text instead of answering", () => {
    const pending = assess(initialTriageState(), { text: CHEST }).state;
    const { assessment } = assess(pending, { text: "can you just tell me which doctor?" });
    expect(assessment).toMatchObject({ kind: "screen", repeat: true });
  });

  it("escalates on a warning sign that arrives after the checklist was cleared", () => {
    const pending = assess(initialTriageState(), { text: CHEST }).state;
    const cleared = assess(pending, { screening: { id: "chest_pain", positive: [] } }).state;
    const { assessment } = assess(cleared, { text: "now I'm sweating and feel sick" });
    expect(assessment).toEqual({ kind: "emergency", flags: ["cardiac"] });
  });

  it("keeps a conversation in emergency once it got there", () => {
    const emergency = assess(initialTriageState(), { text: "I can't breathe" }).state;
    const { assessment } = assess(emergency, { text: "never mind, I'm fine" });
    expect(assessment).toEqual({ kind: "emergency", flags: ["breathing"] });
  });

  it("proceeds without a floor when nothing concerning was said", () => {
    const { assessment } = assess(initialTriageState(), {
      text: "I want a second opinion on my knee MRI",
    });
    expect(assessment).toEqual({ kind: "proceed", floor: null, clearedScreens: [] });
  });
});
