// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  AssistantTurn,
  Conversation,
  Locale,
  SendMessageRequest,
  TraceStep,
  Urgency,
} from "@healtrip/contracts";
import { type AgentRun, AgentService } from "../agent/agent.service.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import {
  DIRECTORY_REPOSITORY,
  type DirectoryRepository,
} from "../directory/directory.repository.js";
import { toProviderCard } from "../directory/provider-card.js";
import {
  EMERGENCY_LABEL,
  EMERGENCY_STICKY_NOTE,
  emergencyMessage,
  fallbackMessage,
  LANGUAGE_NAME,
  SCREEN_STILL_PENDING,
  type ScreenDefinition,
} from "../i18n/messages.js";
import type { TokenUsage } from "../llm/model-client.js";
import type { RedFlag } from "../triage/red-flags.js";
import { assess } from "../triage/triage.js";
import { type ConversationState, InMemoryConversationStore } from "./conversation.store.js";

/** Long enough for real care navigation, short enough to bound cost and context. */
const MAX_TURNS = 20;

const SCREEN_LABEL: Record<ScreenDefinition["id"], string> = { chest_pain: "chest pain" };

/**
 * One patient turn, in a fixed order: record what the patient said, let the
 * deterministic triage decide whether the model may answer at all, then run
 * the agent and build the reply from directory records.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger("conversations");

  constructor(
    private readonly store: InMemoryConversationStore,
    @Inject(DIRECTORY_REPOSITORY) private readonly directory: DirectoryRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly agent: AgentService,
  ) {}

  create(locale: Locale): Conversation {
    const state = this.store.create(locale);
    return {
      conversationId: state.id,
      locale,
      engine: this.agent.engine,
      expiresAt: this.store.expiresAt(state).toISOString(),
    };
  }

  async send(id: string, request: SendMessageRequest): Promise<AssistantTurn> {
    const state = this.store.get(id);
    if (!state) {
      throw new NotFoundException({
        code: "conversation_not_found",
        message: "This conversation does not exist or has expired. Start a new one.",
      });
    }
    if (state.busy) {
      throw new ConflictException({
        code: "turn_in_progress",
        message: "A reply to your previous message is still being prepared.",
      });
    }
    if (state.turn >= MAX_TURNS) {
      throw new ConflictException({
        code: "conversation_limit",
        message: "This conversation has reached its length limit. Start a new one.",
      });
    }

    state.busy = true;
    const started = Date.now();
    try {
      const { turn, usage } = await this.answer(state, request);
      // Content stays out of the logs: ids, outcomes and timings are enough to operate this.
      this.logger.log(
        JSON.stringify({
          conversation: state.id,
          turn: turn.turn,
          kind: turn.kind,
          engine: turn.trace.engine,
          tools: turn.trace.steps.map((s) => s.tool),
          grounding: turn.trace.grounding,
          providers: turn.providers.length,
          tokens: usage,
          ms: Date.now() - started,
        }),
      );
      return turn;
    } finally {
      state.busy = false;
      this.store.touch(state);
    }
  }

  private async answer(state: ConversationState, request: SendMessageRequest): Promise<Answered> {
    state.turn += 1;
    state.locale = request.locale;
    const wasEmergency = state.triage.emergency;

    // Every tool call the model left open last turn is answered before anything new is said.
    state.history.push({
      role: "user",
      content: [...state.pendingToolResults, { type: "text", text: patientText(request) }],
    });
    state.pendingToolResults = [];

    const { assessment, state: triage } = assess(state.triage, {
      text: request.text,
      screening: request.screening,
    });
    state.triage = triage;

    switch (assessment.kind) {
      case "emergency":
        return unpriced(
          this.emergency(state, { by: "triage", flags: assessment.flags, repeated: wasEmergency }),
        );
      case "screen":
        return unpriced(this.screen(state, assessment.screen, assessment.repeat));
      case "proceed": {
        state.history.push({
          role: "system",
          content: serviceNote(state.locale, assessment.floor, assessment.clearedScreens),
        });
        const run = await this.agent.run(state, { locale: state.locale, floor: assessment.floor });
        return { turn: await this.fromAgent(state, run), usage: run.usage };
      }
    }
  }

  private async fromAgent(state: ConversationState, run: AgentRun): Promise<AssistantTurn> {
    const trace = { engine: this.agent.engine, steps: run.steps, grounding: run.grounding };
    switch (run.outcome.type) {
      case "escalate":
        // The model saw something the lexicon did not; it is recorded as the model's call, not a triage flag.
        state.triage = { ...state.triage, emergency: true, flags: [] };
        return this.emergency(state, { by: "model", steps: run.steps });

      case "fallback":
        return this.base(state, {
          kind: "fallback",
          message: fallbackMessage(state.locale, run.outcome.reason, this.config.emergencyNumber),
          trace,
        });

      case "respond": {
        const { answer } = run.outcome;
        // Provider details come from the directory, looked up by the ids the model chose.
        const listings = await this.directory.findByIds(answer.provider_ids);
        return this.base(state, {
          kind: answer.kind,
          message: answer.message,
          questions: answer.questions,
          nextStep: answer.next_step,
          urgency: answer.urgency,
          providers: listings.map((l) => toProviderCard(l, state.locale)),
          trace,
        });
      }
    }
  }

  private emergency(state: ConversationState, cause: EmergencyCause): AssistantTurn {
    const number = this.config.emergencyNumber;
    const wording =
      cause.by === "triage" && cause.flags.includes("self_harm") ? "self_harm" : "general";
    let message = emergencyMessage(state.locale, number, wording);
    if (cause.by === "triage" && cause.repeated)
      message = `${message} ${EMERGENCY_STICKY_NOTE[state.locale]}`;
    // A model escalation already sits in the transcript as a tool call; triage has to record its own reply.
    if (cause.by === "triage") state.history.push({ role: "assistant", content: message });
    return this.base(state, {
      kind: "emergency",
      message,
      nextStep: "emergency_services",
      urgency: "immediate",
      emergency: { number, label: EMERGENCY_LABEL[state.locale] },
      trace:
        cause.by === "triage"
          ? {
              engine: "deterministic",
              steps: [
                { tool: "triage", summary: `red flags: ${cause.flags.join(", ")}`, ok: true },
              ],
              grounding: "not_applicable",
            }
          : { engine: this.agent.engine, steps: cause.steps, grounding: "not_applicable" },
    });
  }

  private screen(
    state: ConversationState,
    screen: ScreenDefinition,
    repeat: boolean,
  ): AssistantTurn {
    const locale = state.locale;
    const message = repeat ? SCREEN_STILL_PENDING[locale] : screen.message[locale];
    const items = screen.items.map((item) => ({ id: item.id, label: item.label[locale] }));
    // The model never sees this turn happen, so the transcript records what was asked.
    state.history.push({
      role: "assistant",
      content: [message, screen.prompt[locale], ...items.map((i) => `- ${i.label}`)].join("\n"),
    });
    return this.base(state, {
      kind: "safety_screen",
      message,
      screening: { id: screen.id, prompt: screen.prompt[locale], items },
      trace: {
        engine: "deterministic",
        steps: [
          { tool: "triage", summary: `${SCREEN_LABEL[screen.id]} checklist required`, ok: true },
        ],
        grounding: "not_applicable",
      },
    });
  }

  private base(
    state: ConversationState,
    turn: Pick<AssistantTurn, "kind" | "message" | "trace"> & Partial<AssistantTurn>,
  ): AssistantTurn {
    return {
      conversationId: state.id,
      turn: state.turn,
      questions: [],
      nextStep: null,
      urgency: null,
      providers: [],
      screening: null,
      emergency: null,
      ...turn,
    };
  }
}

type EmergencyCause =
  { by: "triage"; flags: RedFlag[]; repeated: boolean } | { by: "model"; steps: TraceStep[] };

interface Answered {
  turn: AssistantTurn;
  /** Tokens spent on the turn; null when no model was called. */
  usage: TokenUsage | null;
}

const unpriced = (turn: AssistantTurn): Answered => ({ turn, usage: null });

/** The patient's message as the model will read it, including a checklist answer. */
function patientText(request: SendMessageRequest): string {
  const parts: string[] = [];
  if (request.screening) {
    parts.push(
      request.screening.positive.length === 0
        ? "[Safety checklist answered: none of the warning signs apply.]"
        : `[Safety checklist answered: these apply: ${request.screening.positive.join(", ")}.]`,
    );
  }
  if (request.text) parts.push(request.text);
  return parts.join("\n");
}

/**
 * Facts for this turn, sent as a mid-conversation system message: operator
 * authority, kept apart from anything the patient typed, and appended rather
 * than edited into the frozen system prompt so the cache survives.
 */
function serviceNote(
  locale: Locale,
  floor: Urgency | null,
  cleared: ScreenDefinition["id"][],
): string {
  const lines = [`Service note. Reply language: ${LANGUAGE_NAME[locale]} (${locale}).`];
  for (const id of cleared) {
    lines.push(
      `Safety screen: the ${SCREEN_LABEL[id]} checklist is complete and the patient reported none of the warning signs.`,
    );
  }
  if (floor) lines.push(`Minimum urgency for any recommendation: ${floor}.`);
  return lines.join("\n");
}
