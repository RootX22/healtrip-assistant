// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type { Locale, ProviderCard } from "@healtrip/contracts";
import type { DoctorListing } from "./types.js";

/** The only way provider facts reach a patient: straight from a directory record. */
export function toProviderCard(
  { doctor, facility, specialty }: DoctorListing,
  locale: Locale,
): ProviderCard {
  const ar = locale === "ar";
  return {
    id: doctor.id,
    name: ar ? doctor.nameAr : doctor.nameEn,
    specialty: ar ? specialty.nameAr : specialty.nameEn,
    focus: ar ? doctor.focusAr : doctor.focusEn,
    yearsExperience: doctor.yearsExperience,
    languages: doctor.languages,
    services: {
      inPerson: doctor.inPerson,
      telemedicine: doctor.telemedicine,
      secondOpinion: doctor.secondOpinion,
    },
    fee: { amount: doctor.feeAmount, currency: doctor.feeCurrency },
    typicalWaitDays: doctor.typicalWaitDays,
    facility: {
      name: ar ? facility.nameAr : facility.nameEn,
      kind: facility.kind,
      city: ar ? facility.cityAr : facility.cityEn,
      countryCode: facility.countryCode,
      hasEmergencyDepartment: facility.hasEmergencyDepartment,
    },
  };
}
