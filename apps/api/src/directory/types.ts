// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type { FacilityKind, Service } from "@healtrip/contracts";

export interface Specialty {
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface Facility {
  id: string;
  nameEn: string;
  nameAr: string;
  kind: FacilityKind;
  /** Null only for virtual clinics, which serve every city. */
  cityEn: string | null;
  cityAr: string | null;
  countryCode: string;
  hasEmergencyDepartment: boolean;
  acceptsInternationalPatients: boolean;
}

export interface Doctor {
  id: string;
  facilityId: string;
  specialtyCode: string;
  nameEn: string;
  nameAr: string;
  focusEn: string | null;
  focusAr: string | null;
  yearsExperience: number;
  /** ISO 639-1 codes. */
  languages: string[];
  inPerson: boolean;
  telemedicine: boolean;
  secondOpinion: boolean;
  feeAmount: number;
  /** ISO 4217 code. */
  feeCurrency: string;
  typicalWaitDays: number;
}

/** A doctor joined with what is needed to present or reason about them. */
export interface DoctorListing {
  doctor: Doctor;
  facility: Facility;
  specialty: Specialty;
}

export interface DoctorQuery {
  specialty: string;
  city?: string | undefined;
  country?: string | undefined;
  language?: string | undefined;
  service?: Service | undefined;
  limit: number;
}

export interface City {
  en: string;
  ar: string;
  countryCode: string;
}
