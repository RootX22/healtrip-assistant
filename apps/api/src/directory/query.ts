// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { normalizeText, stem, tokenize } from "../common/text.js";
import type { City, Doctor, DoctorListing, DoctorQuery, Facility } from "./types.js";

const cityKey = (name: string): string => tokenize(normalizeText(name)).map(stem).join(" ");

/**
 * Maps whatever the patient or the model typed ("riyadh", "الرياض",
 * "بالرياض") to a directory city. Both repositories resolve through here, so
 * Postgres and the in-memory store cannot disagree about a city.
 */
export function resolveCity(input: string, cities: readonly City[]): City | null {
  const key = cityKey(input);
  return cities.find((city) => cityKey(city.en) === key || cityKey(city.ar) === key) ?? null;
}

/**
 * Filtering rules for a search, written once and shared with the in-memory
 * repository; the Postgres query encodes the same rules and is tested against
 * the same cases. A virtual clinic has no city: it matches a city search only
 * when the patient asked for telemedicine.
 */
export function matches(
  doctor: Doctor,
  facility: Facility,
  query: DoctorQuery,
  city: City | null | undefined,
): boolean {
  if (doctor.specialtyCode !== query.specialty) return false;
  if (query.city !== undefined) {
    const inCity = city !== null && city !== undefined && facility.cityEn === city.en;
    const virtualForTelemedicine =
      facility.kind === "virtual_clinic" && query.service === "telemedicine";
    if (!inCity && !virtualForTelemedicine) return false;
  }
  if (query.country !== undefined && facility.countryCode !== query.country.toUpperCase())
    return false;
  if (query.language !== undefined && !doctor.languages.includes(query.language)) return false;
  if (query.service === "in_person" && !doctor.inPerson) return false;
  if (query.service === "telemedicine" && !doctor.telemedicine) return false;
  if (query.service === "second_opinion" && !doctor.secondOpinion) return false;
  return true;
}

/** Shortest wait first, then the more experienced doctor, then a stable tie-break. */
export function bySuitability(a: DoctorListing, b: DoctorListing): number {
  return (
    a.doctor.typicalWaitDays - b.doctor.typicalWaitDays ||
    b.doctor.yearsExperience - a.doctor.yearsExperience ||
    a.doctor.id.localeCompare(b.doctor.id)
  );
}
