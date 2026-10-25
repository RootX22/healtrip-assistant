// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

/**
 * The HTTP contract between the API and the web client.
 *
 * Both sides import these schemas: the API validates what it receives, the
 * client validates what it is sent back. A field changed here breaks the build
 * on whichever side has not caught up, instead of failing in a browser.
 */
import { z } from "zod";

export const localeSchema = z.enum(["en", "ar"]);
export type Locale = z.infer<typeof localeSchema>;

/** How soon the patient should be seen, most urgent first. */
export const urgencySchema = z.enum(["immediate", "within_24_hours", "within_days", "routine"]);
export type Urgency = z.infer<typeof urgencySchema>;

export const nextStepSchema = z.enum([
  "emergency_services",
  "urgent_care",
  "specialist_visit",
  "second_opinion",
  "telemedicine",
  "primary_care",
]);
export type NextStep = z.infer<typeof nextStepSchema>;

export const serviceSchema = z.enum(["in_person", "telemedicine", "second_opinion"]);
export type Service = z.infer<typeof serviceSchema>;

export const facilityKindSchema = z.enum([
  "hospital",
  "specialty_centre",
  "clinic",
  "virtual_clinic",
]);
export type FacilityKind = z.infer<typeof facilityKindSchema>;

export const specialtySchema = z.object({
  code: z.string(),
  name: z.string(),
});
export type Specialty = z.infer<typeof specialtySchema>;

/**
 * A doctor as the patient sees it. Every field is read from the directory by
 * the server; none of it is ever taken from model output.
 */
export const providerCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  specialty: z.string(),
  focus: z.string().nullable(),
  yearsExperience: z.number().int(),
  languages: z.array(z.string()),
  services: z.object({
    inPerson: z.boolean(),
    telemedicine: z.boolean(),
    secondOpinion: z.boolean(),
  }),
  fee: z.object({ amount: z.number().int(), currency: z.string().length(3) }),
  typicalWaitDays: z.number().int(),
  facility: z.object({
    name: z.string(),
    kind: facilityKindSchema,
    city: z.string().nullable(),
    countryCode: z.string().length(2),
    hasEmergencyDepartment: z.boolean(),
  }),
});
export type ProviderCard = z.infer<typeof providerCardSchema>;

/** A yes/no safety checklist the patient answers before any routing happens. */
export const screeningSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  items: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type Screening = z.infer<typeof screeningSchema>;

export const turnKindSchema = z.enum([
  "emergency",
  "safety_screen",
  "clarify",
  "recommendation",
  "out_of_scope",
  "fallback",
]);
export type TurnKind = z.infer<typeof turnKindSchema>;

export const engineSchema = z.enum(["claude", "rule-based", "deterministic"]);
export type Engine = z.infer<typeof engineSchema>;

export const groundingSchema = z.enum(["passed", "repaired", "rejected", "not_applicable"]);
export type Grounding = z.infer<typeof groundingSchema>;

export const traceStepSchema = z.object({
  tool: z.string(),
  summary: z.string(),
  ok: z.boolean(),
});
export type TraceStep = z.infer<typeof traceStepSchema>;

export const assistantTurnSchema = z.object({
  conversationId: z.string(),
  turn: z.number().int(),
  kind: turnKindSchema,
  message: z.string(),
  questions: z.array(z.string()),
  nextStep: nextStepSchema.nullable(),
  urgency: urgencySchema.nullable(),
  providers: z.array(providerCardSchema),
  screening: screeningSchema.nullable(),
  emergency: z.object({ number: z.string(), label: z.string() }).nullable(),
  /** What happened behind the answer: which engine, which tool calls, and whether it passed grounding. */
  trace: z.object({
    engine: engineSchema,
    steps: z.array(traceStepSchema),
    grounding: groundingSchema,
  }),
});
export type AssistantTurn = z.infer<typeof assistantTurnSchema>;

export const createConversationRequestSchema = z.object({
  locale: localeSchema,
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

export const conversationSchema = z.object({
  conversationId: z.string(),
  locale: localeSchema,
  engine: engineSchema,
  expiresAt: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const screeningAnswerSchema = z.object({
  id: z.string().max(40),
  /** Ids of the checklist items the patient said apply. Empty means none apply. */
  positive: z.array(z.string().max(40)).max(12),
});
export type ScreeningAnswer = z.infer<typeof screeningAnswerSchema>;

export const MAX_MESSAGE_LENGTH = 2000;

export const sendMessageRequestSchema = z
  .object({
    locale: localeSchema,
    text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).optional(),
    screening: screeningAnswerSchema.optional(),
  })
  .refine((body) => body.text !== undefined || body.screening !== undefined, {
    message: "Send either text or a screening answer.",
  });
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const doctorSearchQuerySchema = z.object({
  specialty: z.string().max(40),
  city: z.string().max(60).optional(),
  country: z.string().length(2).optional(),
  language: z.string().min(2).max(3).optional(),
  service: serviceSchema.optional(),
  locale: localeSchema.default("en"),
});
export type DoctorSearchQuery = z.infer<typeof doctorSearchQuerySchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
