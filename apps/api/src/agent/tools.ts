import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { nextStepSchema, serviceSchema, urgencySchema } from "@healtrip/contracts";
import { z } from "zod";
import type { DirectoryRepository } from "../directory/directory.repository.js";
import type { DoctorListing } from "../directory/types.js";

export const SEARCH_LIMIT = 5;
export const MAX_RECOMMENDED = 3;

/**
 * Runtime validation for tool input. The JSON schemas below are strict, which
 * guarantees shape; the limits strict mode cannot express (lengths, counts)
 * are enforced here before any tool runs.
 */
export const searchProvidersInput = z.object({
  specialty: z.string().max(40),
  city: z.string().trim().min(1).max(60).nullable(),
  country: z.string().length(2).nullable(),
  language: z.string().min(2).max(3).nullable(),
  service: serviceSchema.nullable(),
});

export const getProviderInput = z.object({ provider_id: z.string().max(64) });

export const escalateInput = z.object({ reason: z.string().max(500) });

export const respondInput = z.object({
  kind: z.enum(["clarify", "recommendation", "out_of_scope"]),
  message: z.string().trim().min(1).max(1200),
  questions: z.array(z.string().trim().min(1).max(240)).max(3),
  next_step: nextStepSchema.exclude(["emergency_services"]).nullable(),
  urgency: urgencySchema.exclude(["immediate"]).nullable(),
  provider_ids: z.array(z.string().max(64)).max(MAX_RECOMMENDED),
});
export type RespondInput = z.infer<typeof respondInput>;

const nullable = (schema: Record<string, unknown>, description: string) => ({
  anyOf: [schema, { type: "null" }],
  description,
});

export interface Toolkit {
  definitions: BetaTool[];
  specialtyCodes: ReadonlySet<string>;
}

/**
 * Builds the tool definitions from what the directory actually holds, so the
 * enums the model chooses from are exactly the values a search can match.
 * Built once at startup; the order is fixed so the cached prompt prefix stays
 * byte-identical between requests.
 */
export async function buildToolkit(directory: DirectoryRepository): Promise<Toolkit> {
  const [specialties, cities, countries, languages] = await Promise.all([
    directory.listSpecialties(),
    directory.listCities(),
    directory.listCountries(),
    directory.listLanguages(),
  ]);
  const codes = specialties.map((s) => s.code);
  const coverage = cities.map((c) => `${c.en} (${c.countryCode})`).join(", ");

  const definitions: BetaTool[] = [
    {
      name: "search_providers",
      description:
        `Search HealTrip's directory of doctors. Returns at most ${SEARCH_LIMIT} matches, best fit ` +
        `first (shortest typical wait, then experience). The directory has facilities in: ${coverage}. ` +
        "Doctors at virtual clinics see patients anywhere by video and appear in a city search only " +
        'when service is "telemedicine". Pass null for any filter you do not need. An empty result ' +
        "means the directory has no match; widen the search or tell the patient, never fill the gap yourself.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          specialty: { type: "string", enum: codes, description: "Directory specialty code." },
          city: nullable({ type: "string" }, "City, e.g. Riyadh. Null searches every city."),
          country: nullable({ type: "string", enum: countries }, "ISO 3166 country code."),
          language: nullable(
            { type: "string", enum: languages },
            "A language the doctor must speak (ISO 639-1).",
          ),
          service: nullable(
            { type: "string", enum: serviceSchema.options },
            "in_person, telemedicine (video), or second_opinion (review of an existing diagnosis or plan).",
          ),
        },
        required: ["specialty", "city", "country", "language", "service"],
        additionalProperties: false,
      },
    },
    {
      name: "get_provider",
      description:
        "Full directory record for one provider_id returned by search_providers: focus, languages, " +
        "services, fee, typical wait, and the facility.",
      strict: true,
      input_schema: {
        type: "object",
        properties: { provider_id: { type: "string" } },
        required: ["provider_id"],
        additionalProperties: false,
      },
    },
    {
      name: "escalate_emergency",
      description:
        "Stop and direct the patient to emergency care now. Use it whenever anything the patient says " +
        "suggests an emergency, including signs the service's own screening did not catch. The service " +
        "shows the patient fixed emergency guidance; you do not write it.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "What prompted the escalation, for the record." },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
    {
      name: "respond",
      description:
        "Finish the turn: this is the only way your answer reaches the patient. Call it exactly once, on " +
        "its own, after any search results are back. Providers are shown to the patient as cards built " +
        "from the directory, using provider_ids.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: respondInput.shape.kind.options,
            description:
              "clarify: you need answers before advising. recommendation: you can advise a next step. " +
              "out_of_scope: the request is outside care navigation (diagnosis, prescriptions, dosing).",
          },
          message: {
            type: "string",
            description:
              "Two to four plain sentences to the patient, in the reply language from the latest service " +
              "note. No doctor or facility names, no honorifics, prices, phone numbers, addresses or links.",
          },
          questions: {
            type: "array",
            items: { type: "string" },
            description: "Clarifying questions, at most two in practice. Empty when you have none.",
          },
          next_step: nullable(
            { type: "string", enum: respondInput.shape.next_step.unwrap().options },
            "Required for a recommendation; null otherwise.",
          ),
          urgency: nullable(
            { type: "string", enum: respondInput.shape.urgency.unwrap().options },
            "How soon to be seen. Required for a recommendation; null otherwise.",
          ),
          provider_ids: {
            type: "array",
            items: { type: "string" },
            description: `Up to ${MAX_RECOMMENDED} provider_ids returned by search_providers or get_provider in this conversation, best first.`,
          },
        },
        required: ["kind", "message", "questions", "next_step", "urgency", "provider_ids"],
        additionalProperties: false,
      },
    },
  ];

  return { definitions, specialtyCodes: new Set(codes) };
}

/** What the model sees of a listing: enough to choose and to recognise a name the patient uses. */
export function toToolRecord({ doctor, facility, specialty }: DoctorListing) {
  return {
    provider_id: doctor.id,
    name: doctor.nameEn,
    specialty: specialty.code,
    focus: doctor.focusEn,
    years_experience: doctor.yearsExperience,
    languages: doctor.languages,
    services: [
      ...(doctor.inPerson ? ["in_person"] : []),
      ...(doctor.telemedicine ? ["telemedicine"] : []),
      ...(doctor.secondOpinion ? ["second_opinion"] : []),
    ],
    typical_wait_days: doctor.typicalWaitDays,
    fee: `${doctor.feeAmount} ${doctor.feeCurrency}`,
    facility: facility.nameEn,
    facility_type: facility.kind,
    city: facility.cityEn ?? "virtual (any city)",
    country: facility.countryCode,
    has_emergency_department: facility.hasEmergencyDepartment,
    accepts_international_patients: facility.acceptsInternationalPatients,
  };
}
