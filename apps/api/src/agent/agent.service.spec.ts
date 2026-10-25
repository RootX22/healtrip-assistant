import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDirectoryRepository } from "../directory/in-memory-directory.repository.js";
import {
  type ModelClient,
  type ModelReply,
  type ModelRequest,
  ModelUnavailableError,
} from "../llm/model-client.js";
import { type AgentMemory, AgentService } from "./agent.service.js";
import { NameIndex } from "./grounding.js";
import { buildToolkit } from "./tools.js";

type Step = ModelReply | Error;

/** Replays a fixed script of replies and records what it was sent. */
class ScriptedModel implements ModelClient {
  readonly engine = "claude" as const;
  readonly requests: ModelRequest[] = [];
  constructor(private readonly script: Step[]) {}

  async complete(request: ModelRequest): Promise<ModelReply> {
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (next === undefined) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return next;
  }
}

let ids = 0;
const call = (name: string, input: unknown): BetaContentBlock => ({
  type: "tool_use",
  id: `toolu_${(ids += 1)}`,
  name,
  input,
});
const text = (value: string): BetaContentBlock => ({ type: "text", text: value, citations: null });
const reply = (
  stopReason: ModelReply["stopReason"],
  ...content: BetaContentBlock[]
): ModelReply => ({
  content,
  stopReason,
  refusalCategory: null,
  usage: null,
});

const search = (city: string | null = "Riyadh") =>
  call("search_providers", {
    specialty: "cardiology",
    city,
    country: null,
    language: null,
    service: null,
  });
const answer = (
  providerIds: string[],
  message = "A cardiologist should see you this week; these options fit.",
) =>
  call("respond", {
    kind: "recommendation",
    message,
    questions: [],
    next_step: "specialist_visit",
    urgency: "within_days",
    provider_ids: providerIds,
  });

const directory = new InMemoryDirectoryRepository();
const toolkit = await buildToolkit(directory);
const names = new NameIndex(await directory.listNames());

const memory = (): AgentMemory => ({
  history: [{ role: "user", content: "my chest hurts when I climb stairs, I'm in Riyadh" }],
  pendingToolResults: [],
  evidence: new Set(),
});

/**
 * Every tool_use must be answered by a tool_result, either already in the
 * transcript or held for the next user message. A dangling one makes the next
 * request to the API fail.
 */
function expectEveryToolCallAnswered(m: AgentMemory) {
  const asked = m.history.flatMap((msg: BetaMessageParam) =>
    msg.role === "assistant" && typeof msg.content !== "string"
      ? msg.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []))
      : [],
  );
  const answered = [
    ...m.history.flatMap((msg) =>
      msg.role === "user" && typeof msg.content !== "string"
        ? msg.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))
        : [],
    ),
    ...m.pendingToolResults.map((r: BetaToolResultBlockParam) => r.tool_use_id),
  ];
  expect(new Set(answered)).toEqual(new Set(asked));
}

const run = (model: ModelClient, m = memory()) =>
  new AgentService(model, directory, toolkit, names).run(m, { locale: "en", floor: "within_days" });

describe("AgentService", () => {
  beforeEach(() => {
    ids = 0;
  });

  it("searches, answers with a returned provider, and records the evidence", async () => {
    const m = memory();
    const result = await run(
      new ScriptedModel([
        reply("tool_use", search()),
        reply("tool_use", answer(["doc_sara_otaibi"])),
      ]),
      m,
    );
    expect(result.outcome).toMatchObject({
      type: "respond",
      answer: { provider_ids: ["doc_sara_otaibi"] },
    });
    expect(result.grounding).toBe("passed");
    expect(m.evidence).toEqual(new Set(["doc_sara_otaibi", "doc_khalid_harbi"]));
    expect(m.pendingToolResults).toHaveLength(1);
    expectEveryToolCallAnswered(m);
  });

  it("sends the rejection back and accepts the corrected answer", async () => {
    const model = new ScriptedModel([
      reply("tool_use", search()),
      reply("tool_use", answer(["doc_invented"])),
      reply("tool_use", answer(["doc_sara_otaibi"])),
    ]);
    const m = memory();
    const result = await run(model, m);
    expect(result.grounding).toBe("repaired");
    expect(result.outcome.type).toBe("respond");
    const feedback = model.requests[2]?.messages.at(-1);
    expect(JSON.stringify(feedback)).toContain("doc_invented were not returned");
    expectEveryToolCallAnswered(m);
  });

  it("gives up after a second rejected answer instead of showing it", async () => {
    const m = memory();
    const result = await run(
      new ScriptedModel([
        reply("tool_use", search()),
        reply("tool_use", answer(["doc_sara_otaibi"], "Dr. Sara Al-Otaibi is the best choice.")),
        reply("tool_use", answer(["doc_sara_otaibi"], "Sara Al-Otaibi is the best choice.")),
      ]),
      m,
    );
    expect(result.outcome).toEqual({ type: "fallback", reason: "grounding_failed" });
    expect(result.grounding).toBe("rejected");
    expectEveryToolCallAnswered(m);
  });

  it("refuses an answer sent alongside a search, before the results exist", async () => {
    const m = memory();
    const result = await run(
      new ScriptedModel([
        reply("tool_use", search(), answer(["doc_sara_otaibi"])),
        reply("tool_use", answer(["doc_sara_otaibi"])),
      ]),
      m,
    );
    expect(result.outcome.type).toBe("respond");
    expect(result.steps.map((s) => s.ok)).toEqual([true, false, true]);
    expectEveryToolCallAnswered(m);
  });

  it("returns invalid tool input to the model to fix", async () => {
    const model = new ScriptedModel([
      reply(
        "tool_use",
        call("search_providers", {
          specialty: "astrology",
          city: null,
          country: null,
          language: null,
          service: null,
        }),
      ),
      reply("tool_use", search()),
      reply("tool_use", answer(["doc_sara_otaibi"])),
    ]);
    const m = memory();
    const result = await run(model, m);
    expect(result.outcome.type).toBe("respond");
    expect(JSON.stringify(model.requests[1]?.messages.at(-1))).toContain(
      'Unknown specialty \\"astrology\\"',
    );
    expectEveryToolCallAnswered(m);
  });

  it("escalates when the model calls for emergency care", async () => {
    const m = memory();
    const result = await run(
      new ScriptedModel([
        reply("tool_use", call("escalate_emergency", { reason: "new arm pain" })),
      ]),
      m,
    );
    expect(result.outcome).toEqual({ type: "escalate", reason: "new arm pain" });
    expectEveryToolCallAnswered(m);
  });

  it("asks once for a missing answer, then falls back", async () => {
    const reminded = await run(
      new ScriptedModel([
        reply("end_turn", text("Hmm.")),
        reply("tool_use", search()),
        reply("tool_use", answer(["doc_sara_otaibi"])),
      ]),
    );
    expect(reminded.outcome.type).toBe("respond");

    const m = memory();
    const gaveUp = await run(
      new ScriptedModel([
        reply("end_turn", text("Hmm.")),
        reply("end_turn", text("Still thinking.")),
      ]),
      m,
    );
    expect(gaveUp.outcome).toEqual({ type: "fallback", reason: "incomplete" });
    expectEveryToolCallAnswered(m);
  });

  it("does not run tool calls from a refused turn", async () => {
    const m = memory();
    const result = await run(new ScriptedModel([reply("refusal", search())]), m);
    expect(result.outcome).toEqual({ type: "fallback", reason: "model_unavailable" });
    expect(m.evidence.size).toBe(0);
    expect(m.pendingToolResults[0]).toMatchObject({ is_error: true });
    expectEveryToolCallAnswered(m);
  });

  it("falls back when the model is unreachable", async () => {
    const m = memory();
    const result = await run(new ScriptedModel([new ModelUnavailableError("down", true)]), m);
    expect(result.outcome).toEqual({ type: "fallback", reason: "model_unavailable" });
    expectEveryToolCallAnswered(m);
  });

  it("lets an unexpected error surface instead of reporting it as an outage", async () => {
    await expect(run(new ScriptedModel([new TypeError("bug in our code")]))).rejects.toThrow(
      TypeError,
    );
  });

  it("falls back when the model fails part-way through a turn", async () => {
    const m = memory();
    const result = await run(
      new ScriptedModel([reply("tool_use", search()), new ModelUnavailableError("down", true)]),
      m,
    );
    expect(result.outcome).toEqual({ type: "fallback", reason: "model_unavailable" });
    expectEveryToolCallAnswered(m);
  });

  it("stops after its call budget", async () => {
    const m = memory();
    const model = new ScriptedModel(Array.from({ length: 10 }, () => reply("tool_use", search())));
    const result = await run(model, m);
    expect(result.outcome).toEqual({ type: "fallback", reason: "incomplete" });
    expect(model.requests).toHaveLength(6);
    expectEveryToolCallAnswered(m);
  });

  it("never edits earlier turns", async () => {
    const m = memory();
    const before = structuredClone(m.history);
    await run(
      new ScriptedModel([
        reply("tool_use", search()),
        reply("tool_use", answer(["doc_sara_otaibi"])),
      ]),
      m,
    );
    expect(m.history.slice(0, before.length)).toEqual(before);
  });
});
