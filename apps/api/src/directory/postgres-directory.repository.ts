// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import type { OnApplicationShutdown } from "@nestjs/common";
import type { FacilityKind } from "@healtrip/contracts";
import type pg from "pg";
import type { DirectoryRepository } from "./directory.repository.js";
import { resolveCity } from "./query.js";
import type { City, DoctorListing, DoctorQuery, Specialty } from "./types.js";

interface ListingRow {
  doctor_id: string;
  facility_id: string;
  specialty_code: string;
  doctor_name_en: string;
  doctor_name_ar: string;
  focus_en: string | null;
  focus_ar: string | null;
  years_experience: number;
  languages: string[];
  in_person: boolean;
  telemedicine: boolean;
  second_opinion: boolean;
  fee_amount: number;
  fee_currency: string;
  typical_wait_days: number;
  facility_name_en: string;
  facility_name_ar: string;
  facility_kind: FacilityKind;
  city_en: string | null;
  city_ar: string | null;
  country_code: string;
  has_emergency_department: boolean;
  accepts_international_patients: boolean;
  specialty_name_en: string;
  specialty_name_ar: string;
}

const LISTING_COLUMNS = `
  d.id AS doctor_id, d.facility_id, d.specialty_code,
  d.name_en AS doctor_name_en, d.name_ar AS doctor_name_ar, d.focus_en, d.focus_ar,
  d.years_experience, d.languages, d.in_person, d.telemedicine, d.second_opinion,
  d.fee_amount, d.fee_currency, d.typical_wait_days,
  f.name_en AS facility_name_en, f.name_ar AS facility_name_ar, f.kind AS facility_kind,
  f.city_en, f.city_ar, f.country_code, f.has_emergency_department, f.accepts_international_patients,
  s.name_en AS specialty_name_en, s.name_ar AS specialty_name_ar
FROM doctors d
JOIN facilities f ON f.id = d.facility_id
JOIN specialties s ON s.code = d.specialty_code`;

// Same rules as query.ts `matches`; the shared repository tests hold the two together.
const SEARCH_SQL = `
SELECT ${LISTING_COLUMNS}
WHERE d.specialty_code = $1
  AND (
    $2::text IS NULL
    OR f.city_en = $2
    OR (f.kind = 'virtual_clinic' AND $5::text = 'telemedicine')
  )
  AND ($3::text IS NULL OR f.country_code = $3)
  AND ($4::text IS NULL OR $4 = ANY (d.languages))
  AND (
    $5::text IS NULL
    OR ($5 = 'in_person' AND d.in_person)
    OR ($5 = 'telemedicine' AND d.telemedicine)
    OR ($5 = 'second_opinion' AND d.second_opinion)
  )
ORDER BY d.typical_wait_days, d.years_experience DESC, d.id
LIMIT $6`;

function toListing(row: ListingRow): DoctorListing {
  return {
    doctor: {
      id: row.doctor_id,
      facilityId: row.facility_id,
      specialtyCode: row.specialty_code,
      nameEn: row.doctor_name_en,
      nameAr: row.doctor_name_ar,
      focusEn: row.focus_en,
      focusAr: row.focus_ar,
      yearsExperience: row.years_experience,
      languages: row.languages,
      inPerson: row.in_person,
      telemedicine: row.telemedicine,
      secondOpinion: row.second_opinion,
      feeAmount: row.fee_amount,
      feeCurrency: row.fee_currency,
      typicalWaitDays: row.typical_wait_days,
    },
    facility: {
      id: row.facility_id,
      nameEn: row.facility_name_en,
      nameAr: row.facility_name_ar,
      kind: row.facility_kind,
      cityEn: row.city_en,
      cityAr: row.city_ar,
      countryCode: row.country_code,
      hasEmergencyDepartment: row.has_emergency_department,
      acceptsInternationalPatients: row.accepts_international_patients,
    },
    specialty: {
      code: row.specialty_code,
      nameEn: row.specialty_name_en,
      nameAr: row.specialty_name_ar,
    },
  };
}

export class PostgresDirectoryRepository implements DirectoryRepository, OnApplicationShutdown {
  readonly kind = "postgres" as const;
  private cities: City[] | null = null;

  constructor(private readonly pool: pg.Pool) {}

  async listSpecialties(): Promise<Specialty[]> {
    const { rows } = await this.pool.query<{ code: string; name_en: string; name_ar: string }>(
      "SELECT code, name_en, name_ar FROM specialties ORDER BY code",
    );
    return rows.map((r) => ({ code: r.code, nameEn: r.name_en, nameAr: r.name_ar }));
  }

  async listCities(): Promise<City[]> {
    // Cities change with the directory, not per request; read them once.
    if (this.cities === null) {
      const { rows } = await this.pool.query<{
        city_en: string;
        city_ar: string;
        country_code: string;
      }>(
        `SELECT DISTINCT city_en, city_ar, country_code FROM facilities
         WHERE city_en IS NOT NULL ORDER BY city_en`,
      );
      this.cities = rows.map((r) => ({
        en: r.city_en,
        ar: r.city_ar,
        countryCode: r.country_code,
      }));
    }
    return this.cities;
  }

  async listLanguages(): Promise<string[]> {
    const { rows } = await this.pool.query<{ code: string }>(
      "SELECT DISTINCT unnest(languages) AS code FROM doctors ORDER BY code",
    );
    return rows.map((r) => r.code);
  }

  async listCountries(): Promise<string[]> {
    const { rows } = await this.pool.query<{ country_code: string }>(
      "SELECT DISTINCT country_code FROM facilities ORDER BY country_code",
    );
    return rows.map((r) => r.country_code);
  }

  async search(query: DoctorQuery): Promise<DoctorListing[]> {
    let city: string | null = null;
    if (query.city !== undefined) {
      // An unknown city must match no city at all, not every city: '' matches no row.
      city = resolveCity(query.city, await this.listCities())?.en ?? "";
    }
    const { rows } = await this.pool.query<ListingRow>(SEARCH_SQL, [
      query.specialty,
      city,
      query.country?.toUpperCase() ?? null,
      query.language ?? null,
      query.service ?? null,
      query.limit,
    ]);
    return rows.map(toListing);
  }

  async findByIds(ids: readonly string[]): Promise<DoctorListing[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query<ListingRow>(
      `SELECT ${LISTING_COLUMNS} WHERE d.id = ANY ($1::text[])`,
      [ids],
    );
    const byId = new Map(rows.map((row) => [row.doctor_id, toListing(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  async listNames(): Promise<string[]> {
    const { rows } = await this.pool.query<{ name_en: string; name_ar: string }>(
      "SELECT name_en, name_ar FROM doctors UNION ALL SELECT name_en, name_ar FROM facilities",
    );
    return rows.flatMap((r) => [r.name_en, r.name_ar]);
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
