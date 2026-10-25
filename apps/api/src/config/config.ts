// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { Global, Module } from "@nestjs/common";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /** Number of proxy hops to trust for the client address. The web app proxies /api, so 1 in practice. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  DATABASE_URL: z.url().optional(),
  LLM_ENGINE: z.enum(["claude", "rule-based"]).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  CONVERSATION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  EMERGENCY_NUMBER: z
    .string()
    .regex(/^\d{3,4}$/)
    .default("997"),
});

export interface AppConfig {
  env: "development" | "test" | "production";
  port: number;
  corsOrigin: string;
  trustProxyHops: number;
  databaseUrl: string | null;
  engine: "claude" | "rule-based";
  anthropic: {
    apiKey: string | null;
    model: string;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
    timeoutMs: number;
  };
  conversationTtlMs: number;
  emergencyNumber: string;
}

export const APP_CONFIG = Symbol("APP_CONFIG");

/**
 * Read and validate the environment once, at startup. A bad value stops the
 * process with a message naming the variable, instead of surfacing later as a
 * failed request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // An empty value means "not set": docker compose passes unset variables as "".
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;

  // Without a key the service still runs end to end on the rule-based engine,
  // which is what a reviewer without credentials gets from `docker compose up`.
  const engine = e.LLM_ENGINE ?? (e.ANTHROPIC_API_KEY ? "claude" : "rule-based");
  if (engine === "claude" && !e.ANTHROPIC_API_KEY) {
    throw new Error("LLM_ENGINE=claude requires ANTHROPIC_API_KEY.");
  }

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    corsOrigin: e.CORS_ORIGIN,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    databaseUrl: e.DATABASE_URL ?? null,
    engine,
    anthropic: {
      apiKey: e.ANTHROPIC_API_KEY ?? null,
      model: e.ANTHROPIC_MODEL,
      effort: e.ANTHROPIC_EFFORT,
      timeoutMs: e.ANTHROPIC_TIMEOUT_MS,
    },
    conversationTtlMs: e.CONVERSATION_TTL_MINUTES * 60_000,
    emergencyNumber: e.EMERGENCY_NUMBER,
  };
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
