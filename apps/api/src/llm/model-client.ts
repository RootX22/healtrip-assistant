import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

export interface ModelRequest {
  system: string;
  tools: BetaTool[];
  messages: BetaMessageParam[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface ModelReply {
  content: BetaContentBlock[];
  stopReason: BetaMessage["stop_reason"];
  /** Why the model declined, when it did. */
  refusalCategory: string | null;
  /** Null for the rule-based engine, which costs nothing. */
  usage: TokenUsage | null;
}

/**
 * The agent's only view of a model. Messages use the Anthropic shapes on both
 * sides, so the rule-based engine plugs into exactly the loop Claude runs in.
 */
export interface ModelClient {
  readonly engine: "claude" | "rule-based";
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelReply>;
}

export const MODEL_CLIENT = Symbol("MODEL_CLIENT");

export class ModelUnavailableError extends Error {
  constructor(
    message: string,
    /** True when trying again later could succeed: rate limits, outages, timeouts. */
    readonly transient: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelUnavailableError";
  }
}
