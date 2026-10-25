import {
  type AssistantTurn,
  assistantTurnSchema,
  type Conversation,
  conversationSchema,
  errorResponseSchema,
  type Locale,
  type SendMessageRequest,
} from "@healtrip/contracts";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

/** Every response is parsed against the shared contract: a drifted API fails here, loudly. */
async function call<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", "network");
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiError(
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.requestId,
      );
    }
    throw new ApiError("unexpected", `HTTP ${response.status}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new ApiError("contract", "The server sent a response this page does not understand.");
  return parsed.data;
}

export const startConversation = (locale: Locale): Promise<Conversation> =>
  call("/api/v1/conversations", { locale }, conversationSchema);

export const sendMessage = (
  conversationId: string,
  request: SendMessageRequest,
): Promise<AssistantTurn> =>
  call(`/api/v1/conversations/${conversationId}/messages`, request, assistantTurnSchema);
