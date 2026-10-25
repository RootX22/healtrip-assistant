// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Grounding, Locale, TraceStep, Urgency } from "@healtrip/contracts";
import type { z } from "zod";
import {
  DIRECTORY_REPOSITORY,
  type DirectoryRepository,
} from "../directory/directory.repository.js";
import type { DoctorListing } from "../directory/types.js";
import type { FallbackReason } from "../i18n/messages.js";
import {
  MODEL_CLIENT,
  type ModelClient,
  type ModelReply,
  ModelUnavailableError,
  type TokenUsage,
} from "../llm/model-client.js";
import { checkRespond, type NameIndex } from "./grounding.js";
import { RESPOND_REMINDER, SYSTEM_PROMPT } from "./system-prompt.js";
import {
  escalateInput,
  getProviderInput,
  type RespondInput,
  SEARCH_LIMIT,
  searchProvidersInput,
  type Toolkit,
  toToolRecord,
} from "./tools.js";

export const AGENT_TOOLKIT = Symbol("AGENT_TOOLKIT");
export const NAME_INDEX = Symbol("NAME_INDEX");

/** Model calls per patient turn: a search, a refinement, a lookup, a repair, and room to spare. */
const MAX_MODEL_CALLS = 6;
/** A second rejected answer means the model cannot ground this one; stop and say so. */
const MAX_REJECTED_ANSWERS = 2;

/** What the agent reads and appends to. The conversation owns it; the agent never rewrites it. */
export interface AgentMemory {
  history: BetaMessageParam[];
  /** Results owed for tool calls left open at the end of the last turn. */
  pendingToolResults: BetaToolResultBlockParam[];
  /** Every provider_id a tool has returned in this conversation. */
  evidence: Set<string>;
}

export type AgentOutcome =
  | { type: "respond"; answer: RespondInput }
  | { type: "escalate"; reason: string }
  | { type: "fallback"; reason: FallbackReason };

export interface AgentRun {
  outcome: AgentOutcome;
  steps: TraceStep[];
  grounding: Grounding;
  usage: TokenUsage;
}

interface TurnContext {
  locale: Locale;
  floor: Urgency | null;
}

/** Everything one patient turn accumulates while the loop runs. */
interface Turn {
  memory: AgentMemory;
  context: TurnContext;
  steps: TraceStep[];
  rejectedAnswers: number;
  reminded: boolean;
  usage: TokenUsage;
}

/** The result owed for one tool call, and the outcome when that call ends the turn. */
interface CallOutcome {
  result: BetaToolResultBlockParam;
  ends?: AgentOutcome;
}

const toolResult = (id: string, content: unknown): BetaToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content: typeof content === "string" ? content : JSON.stringify(content),
});

const toolError = (id: string, message: string): BetaToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content: message,
  is_error: true,
});

const isToolUse = (block: BetaContentBlock): block is BetaToolUseBlock => block.type === "tool_use";

const describeIssues = (error: z.ZodError): string =>
  `Invalid input: ${error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`;

function groundingOf(outcome: AgentOutcome, rejectedAnswers: number): Grounding {
  if (outcome.type === "respond") return rejectedAnswers > 0 ? "repaired" : "passed";
  if (outcome.type === "fallback" && outcome.reason === "grounding_failed") return "rejected";
  return "not_applicable";
}

/**
 * Runs one patient turn against the model with a manual tool loop.
 *
 * The loop is written out rather than delegated to an SDK runner because the
 * interesting decisions live between the steps: every tool input is validated
 * before it runs, every answer is checked against what the tools returned
 * before the patient sees it, and every exit - success, emergency, or failure -
 * leaves the transcript in a state the next turn can continue from.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger("agent");

  constructor(
    @Inject(MODEL_CLIENT) private readonly model: ModelClient,
    @Inject(DIRECTORY_REPOSITORY) private readonly directory: DirectoryRepository,
    @Inject(AGENT_TOOLKIT) private readonly toolkit: Toolkit,
    @Inject(NAME_INDEX) private readonly names: NameIndex,
  ) {}

  get engine(): ModelClient["engine"] {
    return this.model.engine;
  }

  async run(memory: AgentMemory, context: TurnContext): Promise<AgentRun> {
    const turn: Turn = {
      memory,
      context,
      steps: [],
      rejectedAnswers: 0,
      reminded: false,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    };

    for (let call = 0; call < MAX_MODEL_CALLS; call += 1) {
      const reply = await this.ask(turn);
      if (reply === null)
        return this.finish(turn, { type: "fallback", reason: "model_unavailable" });

      // Appended verbatim, thinking blocks included: earlier turns are never edited.
      memory.history.push({ role: "assistant", content: reply.content });
      const calls = reply.content.filter(isToolUse);

      if (reply.stopReason === "refusal" || reply.stopReason === "max_tokens") {
        return this.finish(turn, this.abandon(turn, reply, calls));
      }
      if (calls.length === 0) {
        if (turn.reminded) return this.finish(turn, { type: "fallback", reason: "incomplete" });
        this.remind(turn);
        continue;
      }
      const outcome = await this.answerCalls(turn, calls);
      if (outcome) return this.finish(turn, outcome);
    }

    turn.steps.push({
      tool: "model",
      summary: `no answer after ${MAX_MODEL_CALLS} calls`,
      ok: false,
    });
    return this.finish(turn, { type: "fallback", reason: "incomplete" });
  }

  /** One model call. Null means the model is unavailable; anything else that fails is a bug and propagates. */
  private async ask(turn: Turn): Promise<ModelReply | null> {
    try {
      const reply = await this.model.complete({
        system: SYSTEM_PROMPT,
        tools: this.toolkit.definitions,
        messages: turn.memory.history,
      });
      if (reply.usage) {
        turn.usage.inputTokens += reply.usage.inputTokens;
        turn.usage.outputTokens += reply.usage.outputTokens;
        turn.usage.cacheReadTokens += reply.usage.cacheReadTokens;
      }
      return reply;
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) throw error;
      this.logger.warn(`model unavailable (${error.transient ? "transient" : "needs attention"})`);
      turn.steps.push({ tool: "model", summary: "unavailable", ok: false });
      return null;
    }
  }

  /** A refusal or a cut-off can truncate a tool call mid-input, so none of that message's calls run. */
  private abandon(turn: Turn, reply: ModelReply, calls: BetaToolUseBlock[]): AgentOutcome {
    turn.memory.pendingToolResults = calls.map((c) =>
      toolError(c.id, "Not run: the turn ended early."),
    );
    const why = reply.refusalCategory ? `refusal (${reply.refusalCategory})` : reply.stopReason;
    turn.steps.push({ tool: "model", summary: `stopped: ${why}`, ok: false });
    return {
      type: "fallback",
      reason: reply.stopReason === "refusal" ? "model_unavailable" : "incomplete",
    };
  }

  /** tool_choice cannot force a call on this model, so a missing answer is asked for once. */
  private remind(turn: Turn): void {
    turn.reminded = true;
    turn.steps.push({
      tool: "respond",
      summary: "turn ended without an answer; asked again",
      ok: false,
    });
    turn.memory.history.push({ role: "user", content: [{ type: "text", text: RESPOND_REMINDER }] });
  }

  /** Runs one message's tool calls. Returns an outcome when the turn is over. */
  private async answerCalls(
    turn: Turn,
    calls: BetaToolUseBlock[],
  ): Promise<AgentOutcome | undefined> {
    const results: BetaToolResultBlockParam[] = [];
    let outcome: AgentOutcome | undefined;
    for (const call of calls) {
      const handled = await this.dispatch(call, turn, calls.length);
      results.push(handled.result);
      outcome ??= handled.ends;
    }
    if (!outcome && turn.rejectedAnswers >= MAX_REJECTED_ANSWERS) {
      outcome = { type: "fallback", reason: "grounding_failed" };
    }
    if (outcome) {
      // Owed to the model; they go out with the patient's next message.
      turn.memory.pendingToolResults = results;
      return outcome;
    }
    turn.memory.history.push({ role: "user", content: results });
    return undefined;
  }

  private dispatch(
    call: BetaToolUseBlock,
    turn: Turn,
    callsInMessage: number,
  ): Promise<CallOutcome> {
    switch (call.name) {
      case "search_providers":
        return this.searchProviders(call, turn);
      case "get_provider":
        return this.getProvider(call, turn);
      case "escalate_emergency":
        return Promise.resolve(this.escalate(call, turn));
      case "respond":
        return Promise.resolve(this.respond(call, turn, callsInMessage));
      default:
        return Promise.resolve(
          this.fail(turn, call, "unknown tool", `There is no tool called "${call.name}".`),
        );
    }
  }

  private async searchProviders(call: BetaToolUseBlock, turn: Turn): Promise<CallOutcome> {
    const input = searchProvidersInput.safeParse(call.input);
    if (!input.success) return this.fail(turn, call, "invalid input", describeIssues(input.error));
    const { specialty, city, country, language, service } = input.data;
    if (!this.toolkit.specialtyCodes.has(specialty)) {
      return this.fail(turn, call, "unknown specialty", `Unknown specialty "${specialty}".`);
    }
    let listings: DoctorListing[];
    try {
      listings = await this.directory.search({
        specialty,
        city: city ?? undefined,
        country: country ?? undefined,
        language: language ?? undefined,
        service: service ?? undefined,
        limit: SEARCH_LIMIT,
      });
    } catch (error) {
      return this.directoryUnavailable(turn, call, error);
    }
    for (const listing of listings) turn.memory.evidence.add(listing.doctor.id);
    const filters = [specialty, city, country, language, service].filter(Boolean).join(" · ");
    turn.steps.push({
      tool: call.name,
      summary: `${filters} → ${listings.length} found`,
      ok: true,
    });
    return {
      result: toolResult(call.id, { count: listings.length, results: listings.map(toToolRecord) }),
    };
  }

  private async getProvider(call: BetaToolUseBlock, turn: Turn): Promise<CallOutcome> {
    const input = getProviderInput.safeParse(call.input);
    if (!input.success) return this.fail(turn, call, "invalid input", describeIssues(input.error));
    let listing: DoctorListing | undefined;
    try {
      [listing] = await this.directory.findByIds([input.data.provider_id]);
    } catch (error) {
      return this.directoryUnavailable(turn, call, error);
    }
    if (!listing)
      return this.fail(turn, call, "not found", `No provider with id "${input.data.provider_id}".`);
    turn.memory.evidence.add(listing.doctor.id);
    turn.steps.push({ tool: call.name, summary: listing.doctor.id, ok: true });
    return { result: toolResult(call.id, toToolRecord(listing)) };
  }

  private escalate(call: BetaToolUseBlock, turn: Turn): CallOutcome {
    const input = escalateInput.safeParse(call.input);
    turn.steps.push({ tool: call.name, summary: "patient directed to emergency care", ok: true });
    return {
      result: toolResult(call.id, "Emergency guidance shown to the patient."),
      // Escalation stands even if the stated reason is malformed: the model can only make things safer.
      ends: { type: "escalate", reason: input.success ? input.data.reason : "unspecified" },
    };
  }

  private respond(call: BetaToolUseBlock, turn: Turn, callsInMessage: number): CallOutcome {
    if (callsInMessage > 1) {
      turn.rejectedAnswers += 1;
      return this.fail(
        turn,
        call,
        "rejected: called alongside other tools",
        "Call respond on its own, after the other tool results are back.",
      );
    }
    const verdict = checkRespond(call.input, {
      evidence: turn.memory.evidence,
      floor: turn.context.floor,
      locale: turn.context.locale,
      names: this.names,
    });
    if (!verdict.ok) {
      turn.rejectedAnswers += 1;
      const problems = verdict.problems.join("; ");
      return this.fail(
        turn,
        call,
        `rejected: ${problems}`,
        `Not shown to the patient. Fix these and call respond again: ${problems}.`,
      );
    }
    turn.steps.push({ tool: call.name, summary: `${verdict.value.kind} accepted`, ok: true });
    return {
      result: toolResult(call.id, "Shown to the patient."),
      ends: { type: "respond", answer: verdict.value },
    };
  }

  /**
   * A directory failure is reported to the model rather than thrown: the
   * patient still gets an answer, just without providers this turn.
   */
  private directoryUnavailable(turn: Turn, call: BetaToolUseBlock, error: unknown): CallOutcome {
    this.logger.error(
      "directory call failed",
      error instanceof Error ? error.stack : String(error),
    );
    return this.fail(
      turn,
      call,
      "directory unavailable",
      "The directory is unavailable right now. Do not recommend providers this turn.",
    );
  }

  private fail(turn: Turn, call: BetaToolUseBlock, summary: string, message: string): CallOutcome {
    turn.steps.push({ tool: call.name, summary, ok: false });
    return { result: toolError(call.id, message) };
  }

  private finish(turn: Turn, outcome: AgentOutcome): AgentRun {
    return {
      outcome,
      steps: turn.steps,
      grounding: groundingOf(outcome, turn.rejectedAnswers),
      usage: turn.usage,
    };
  }
}
