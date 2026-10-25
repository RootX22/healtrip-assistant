// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { InMemoryDirectoryRepository } from "../directory/in-memory-directory.repository.js";
import { buildToolkit } from "../agent/tools.js";
import { AnthropicModelClient } from "./anthropic.model-client.js";
import { ModelUnavailableError } from "./model-client.js";

const toolkit = await buildToolkit(new InMemoryDirectoryRepository());

function clientReturning(result: unknown) {
  const create = vi.fn().mockImplementation(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const sdk = { beta: { messages: { create } } } as unknown as Anthropic;
  return {
    create,
    client: new AnthropicModelClient(sdk, { model: "claude-opus-5-5", effort: "medium" }),
  };
}

const message = {
  content: [{ type: "text", text: "ok", citations: null }],
  stop_reason: "end_turn",
  stop_details: null,
  usage: { input_tokens: 120, output_tokens: 8, cache_read_input_tokens: 100 },
};

const request = {
  system: "system",
  tools: toolkit.definitions,
  messages: [
    { role: "user" as const, content: "hi" },
    { role: "system" as const, content: "Service note." },
  ],
};

describe("AnthropicModelClient", () => {
  it("sends the request this design depends on", async () => {
    const { create, client } = clientReturning(message);
    const result = await client.complete(request);

    const params = create.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
      messages: request.messages,
    });
    // Sampling parameters are rejected by current models; forcing a tool is rejected by this one.
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("tool_choice");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 8, cacheReadTokens: 100 });
  });

  it("declares every tool strict, with closed objects", () => {
    for (const tool of toolkit.definitions) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(new Set(tool.input_schema.required)).toEqual(
        new Set(Object.keys(tool.input_schema.properties ?? {})),
      );
    }
  });

  it("reports the refusal category", async () => {
    const { client } = clientReturning({
      ...message,
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "bio", explanation: null },
    });
    expect((await client.complete(request)).refusalCategory).toBe("bio");
  });

  it.each([
    [new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()), true],
    [new Anthropic.InternalServerError(500, undefined, "oops", new Headers()), true],
    [new Anthropic.APIConnectionError({ message: "offline" }), true],
    [new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers()), false],
    [new Anthropic.BadRequestError(400, undefined, "bad request", new Headers()), false],
  ])("translates %s", async (error, transient) => {
    const { client } = clientReturning(error);
    const failure = await client.complete(request).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ModelUnavailableError);
    expect((failure as ModelUnavailableError).transient).toBe(transient);
  });
});
