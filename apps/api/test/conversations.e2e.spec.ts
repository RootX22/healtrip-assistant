// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import "reflect-metadata";
import type { AssistantTurn, Conversation } from "@healtrip/contracts";
import { assistantTurnSchema, errorResponseSchema } from "@healtrip/contracts";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureHttp } from "../src/bootstrap.js";
import { APP_CONFIG, loadConfig } from "../src/config/config.js";
import { MODEL_CLIENT, type ModelClient } from "../src/llm/model-client.js";

const config = loadConfig({ NODE_ENV: "test", LLM_ENGINE: "rule-based" });

async function start(model?: ModelClient): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config);
  if (model) builder = builder.overrideProvider(MODEL_CLIENT).useValue(model);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureHttp(app, config);
  await app.init();
  return app;
}

let app: INestApplication;
afterEach(async () => app?.close());

async function open(locale: "en" | "ar" = "en"): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/api/v1/conversations")
    .send({ locale })
    .expect(201);
  return (res.body as Conversation).conversationId;
}

async function say(id: string, body: object): Promise<AssistantTurn> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/conversations/${id}/messages`)
    .send({ locale: "en", ...body })
    .expect(200);
  // The response has to satisfy the same contract the web client parses with.
  return assistantTurnSchema.parse(res.body);
}

describe("conversations over HTTP", () => {
  it("screens chest pain, then recommends from the directory", async () => {
    app = await start();
    const id = await open();

    const screen = await say(id, { text: "My chest hurts when I climb stairs" });
    expect(screen.kind).toBe("safety_screen");
    expect(screen.screening?.items.map((i) => i.id)).toContain("breathless");
    expect(screen.trace.engine).toBe("deterministic");

    const clarify = await say(id, { screening: { id: "chest_pain", positive: [] } });
    expect(clarify.kind).toBe("clarify");
    expect(clarify.questions.length).toBeGreaterThan(0);

    const recommendation = await say(id, { text: "I'm in Riyadh" });
    expect(recommendation).toMatchObject({
      kind: "recommendation",
      nextStep: "specialist_visit",
      urgency: "within_days",
      trace: { grounding: "passed" },
    });
    expect(recommendation.providers.map((p) => p.id)).toEqual([
      "doc_sara_otaibi",
      "doc_khalid_harbi",
    ]);
    expect(recommendation.providers[0]).toMatchObject({
      name: "Dr. Sara Al-Otaibi",
      fee: { amount: 450, currency: "SAR" },
      facility: { city: "Riyadh" },
    });
  });

  it("goes straight to emergency guidance and stays there", async () => {
    app = await start();
    const id = await open();
    const first = await say(id, { text: "crushing chest pain spreading to my left arm" });
    expect(first).toMatchObject({
      kind: "emergency",
      emergency: { number: "997" },
      nextStep: "emergency_services",
    });
    const second = await say(id, { text: "it's gone now" });
    expect(second.kind).toBe("emergency");
    expect(second.message).toMatch(/start a new conversation/);
  });

  it("escalates from a positive checklist answer", async () => {
    app = await start();
    const id = await open();
    await say(id, { text: "my chest hurts" });
    expect((await say(id, { screening: { id: "chest_pain", positive: ["faint"] } })).kind).toBe(
      "emergency",
    );
  });

  it("answers in Arabic with Arabic directory records", async () => {
    app = await start();
    const id = await open("ar");
    const turn = await say(id, {
      locale: "ar",
      text: "عندي ارتجاع وحموضة من شهور وأبي دكتور في جدة",
    });
    expect(turn.kind).toBe("recommendation");
    expect(turn.providers[0]).toMatchObject({ name: "د. هدى الزهراني", facility: { city: "جدة" } });
  });

  it("uses the self-harm wording for self-harm", async () => {
    app = await start();
    const id = await open("ar");
    const turn = await say(id, { locale: "ar", text: "أفكر أن أنهي حياتي" });
    expect(turn.kind).toBe("emergency");
    expect(turn.message).toContain("إيذاء نفسك");
  });

  it("rejects a second message while the first is still being answered", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: ModelClient = {
      engine: "rule-based",
      complete: async () => {
        await gate;
        return { content: [], stopReason: "end_turn", refusalCategory: null, usage: null };
      },
    };
    app = await start(slow);
    const id = await open();
    const server = app.getHttpServer();
    const first = request(server)
      .post(`/api/v1/conversations/${id}/messages`)
      .send({ locale: "en", text: "knee pain in Dammam" });
    const firstDone = first.then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    const second = await request(server)
      .post(`/api/v1/conversations/${id}/messages`)
      .send({ locale: "en", text: "hello?" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("turn_in_progress");
    release();
    expect((await firstDone).body.kind).toBe("fallback");
  });

  it("returns one error shape, with a request id, for every failure", async () => {
    app = await start();
    const server = app.getHttpServer();
    const id = await open();
    // Built lazily: a supertest request starts its own listener when it is created.
    const cases = [
      [
        () => request(server).post(`/api/v1/conversations/${id}/messages`).send({ locale: "en" }),
        400,
        "invalid_request",
      ],
      [
        () => request(server).post("/api/v1/conversations").send({ locale: "fr" }),
        400,
        "invalid_request",
      ],
      [
        () =>
          request(server)
            .post("/api/v1/conversations/not-a-uuid/messages")
            .send({ locale: "en", text: "x" }),
        400,
        "invalid_request",
      ],
      [
        () =>
          request(server)
            .post("/api/v1/conversations/00000000-0000-4000-8000-000000000000/messages")
            .send({ locale: "en", text: "x" }),
        404,
        "conversation_not_found",
      ],
      [
        () =>
          request(server)
            .post("/api/v1/conversations")
            .set("content-type", "application/json")
            .send('{"locale":'),
        400,
        "invalid_request",
      ],
      [
        () =>
          request(server)
            .post("/api/v1/conversations")
            .send({ locale: "en", pad: "a".repeat(20_000) }),
        413,
        "payload_too_large",
      ],
    ] as const;
    for (const [send, status, code] of cases) {
      const res = await send();
      expect(res.status).toBe(status);
      const body = errorResponseSchema.parse(res.body);
      expect(body.error.code).toBe(code);
      expect(body.error.requestId).toBeTruthy();
    }
  });

  it("exposes the directory and its health", async () => {
    app = await start();
    const server = app.getHttpServer();
    const doctors = await request(server)
      .get("/api/v1/doctors")
      .query({ specialty: "cardiology", city: "الرياض", locale: "ar" })
      .expect(200);
    expect(doctors.body.results.map((r: { name: string }) => r.name)).toEqual([
      "د. سارة العتيبي",
      "د. خالد الحربي",
    ]);
    const health = await request(server).get("/api/health").expect(200);
    expect(health.body).toEqual({
      status: "ok",
      engine: "rule-based",
      directory: "in-memory",
      database: "not_configured",
    });
  });
});
