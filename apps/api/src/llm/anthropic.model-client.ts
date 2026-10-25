import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@nestjs/common";
import type { AppConfig } from "../config/config.js";
import {
  type ModelClient,
  type ModelReply,
  type ModelRequest,
  ModelUnavailableError,
} from "./model-client.js";

// A turn's output is a short reply or a handful of tool calls; the ceiling only
// has to leave room for thinking, and is never reached in practice.
const MAX_TOKENS = 16_000;

export class AnthropicModelClient implements ModelClient {
  readonly engine = "claude" as const;
  private readonly logger = new Logger("claude");

  constructor(
    private readonly client: Anthropic,
    private readonly options: Pick<AppConfig["anthropic"], "model" | "effort">,
  ) {}

  static fromConfig(config: AppConfig): AnthropicModelClient {
    const client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      timeout: config.anthropic.timeoutMs,
      maxRetries: 2,
    });
    return new AnthropicModelClient(client, config.anthropic);
  }

  async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelReply> {
    try {
      const response = await this.client.beta.messages.create(
        {
          model: this.options.model,
          max_tokens: MAX_TOKENS,
          // A declined request is re-run on Anthropic's recommended fallback
          // model inside the same call, instead of leaving the patient with nothing.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          // Every turn resends the whole conversation; caching the prefix
          // (tools, system prompt, earlier turns) keeps that cheap.
          cache_control: { type: "ephemeral" },
          output_config: { effort: this.options.effort },
          system: request.system,
          tools: request.tools,
          messages: request.messages,
        },
        { signal },
      );
      return {
        content: response.content,
        stopReason: response.stop_reason,
        refusalCategory:
          response.stop_reason === "refusal" ? (response.stop_details?.category ?? null) : null,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      };
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Most specific first: what can be retried later and what is a fault on our side. */
  private translate(error: unknown): ModelUnavailableError {
    if (error instanceof Anthropic.APIUserAbortError) {
      return new ModelUnavailableError("Request to Claude was cancelled.", true, { cause: error });
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      this.logger.error(
        `Claude rejected the credentials (${error.status}). Check ANTHROPIC_API_KEY.`,
      );
      return new ModelUnavailableError("Model credentials were rejected.", false, { cause: error });
    }
    if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
      // A request we built is malformed: a bug to fix, not a condition to wait out.
      this.logger.error(`Claude rejected the request (${error.status}): ${error.message}`);
      return new ModelUnavailableError("Model request was rejected.", false, { cause: error });
    }
    if (error instanceof Anthropic.RateLimitError) {
      this.logger.warn("Claude rate limit reached after retries.");
      return new ModelUnavailableError("Model is rate limited.", true, { cause: error });
    }
    if (error instanceof Anthropic.APIError) {
      this.logger.warn(`Claude error ${error.status ?? "without status"} after retries.`);
      return new ModelUnavailableError("Model is unavailable.", true, { cause: error });
    }
    this.logger.error(
      "Unexpected error calling Claude",
      error instanceof Error ? error.stack : String(error),
    );
    return new ModelUnavailableError("Model call failed.", true, { cause: error });
  }
}
