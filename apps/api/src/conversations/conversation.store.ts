import { randomUUID } from "node:crypto";
import type { OnModuleDestroy } from "@nestjs/common";
import type { Locale } from "@healtrip/contracts";
import type { AgentMemory } from "../agent/agent.service.js";
import { initialTriageState, type TriageState } from "../triage/triage.js";

export interface ConversationState extends AgentMemory {
  id: string;
  locale: Locale;
  createdAt: number;
  lastActiveAt: number;
  turn: number;
  /** Set while a turn is being answered, so a double-submit cannot interleave two turns. */
  busy: boolean;
  triage: TriageState;
}

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Conversations hold health information, so they are kept only as long as the
 * patient is active and never written to disk: an idle conversation expires,
 * and a full store drops the least recently used.
 *
 * One instance only. Running several needs a shared store (Redis) and a lock
 * with a timeout in place of the busy flag; that is when an interface earns its place.
 */
export class InMemoryConversationStore implements OnModuleDestroy {
  private readonly items = new Map<string, ConversationState>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly ttlMs: number,
    private readonly capacity = 5_000,
    private readonly now: () => number = Date.now,
  ) {
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  create(locale: Locale): ConversationState {
    if (this.items.size >= this.capacity) {
      const oldest = this.items.keys().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
    const now = this.now();
    const state: ConversationState = {
      id: randomUUID(),
      locale,
      createdAt: now,
      lastActiveAt: now,
      turn: 0,
      busy: false,
      triage: initialTriageState(),
      history: [],
      pendingToolResults: [],
      evidence: new Set(),
    };
    this.items.set(state.id, state);
    return state;
  }

  get(id: string): ConversationState | null {
    const state = this.items.get(id);
    if (!state) return null;
    if (this.expired(state)) {
      this.items.delete(id);
      return null;
    }
    return state;
  }

  touch(state: ConversationState): void {
    state.lastActiveAt = this.now();
    // Re-inserting keeps Map order equal to recency, which is what eviction reads.
    this.items.delete(state.id);
    this.items.set(state.id, state);
  }

  expiresAt(state: ConversationState): Date {
    return new Date(state.lastActiveAt + this.ttlMs);
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  private expired(state: ConversationState): boolean {
    return this.now() - state.lastActiveAt > this.ttlMs;
  }

  private sweep(): void {
    for (const [id, state] of this.items) {
      if (this.expired(state) && !state.busy) this.items.delete(id);
    }
  }
}
