// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

/**
 * Applies pending migrations and upserts the seed directory.
 *
 * Runs as its own step (`npm run db:setup`, or the one-shot `migrate` service
 * in docker compose) rather than at API startup, so several API instances never
 * race each other to change the schema.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { doctors, facilities, specialties } from "../directory/seed-data.js";
import { createPool } from "./pool.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

async function migrate(client: pg.PoolClient): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const pending = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql") && !applied.has(f))
    .sort();

  for (const name of pending) {
    const sql = await readFile(`${MIGRATIONS_DIR}${name}`, "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${name} failed`, { cause: error });
    }
  }
  return pending;
}

async function seed(client: pg.PoolClient): Promise<void> {
  await client.query("BEGIN");
  try {
    for (const s of specialties) {
      await client.query(
        `INSERT INTO specialties (code, name_en, name_ar) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar`,
        [s.code, s.nameEn, s.nameAr],
      );
    }
    for (const f of facilities) {
      await client.query(
        `INSERT INTO facilities (id, name_en, name_ar, kind, city_en, city_ar, country_code,
                                 has_emergency_department, accepts_international_patients)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar, kind = EXCLUDED.kind,
           city_en = EXCLUDED.city_en, city_ar = EXCLUDED.city_ar, country_code = EXCLUDED.country_code,
           has_emergency_department = EXCLUDED.has_emergency_department,
           accepts_international_patients = EXCLUDED.accepts_international_patients`,
        [
          f.id,
          f.nameEn,
          f.nameAr,
          f.kind,
          f.cityEn,
          f.cityAr,
          f.countryCode,
          f.hasEmergencyDepartment,
          f.acceptsInternationalPatients,
        ],
      );
    }
    for (const d of doctors) {
      await client.query(
        `INSERT INTO doctors (id, facility_id, specialty_code, name_en, name_ar, focus_en, focus_ar,
                              years_experience, languages, in_person, telemedicine, second_opinion,
                              fee_amount, fee_currency, typical_wait_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
           facility_id = EXCLUDED.facility_id, specialty_code = EXCLUDED.specialty_code,
           name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar,
           focus_en = EXCLUDED.focus_en, focus_ar = EXCLUDED.focus_ar,
           years_experience = EXCLUDED.years_experience, languages = EXCLUDED.languages,
           in_person = EXCLUDED.in_person, telemedicine = EXCLUDED.telemedicine,
           second_opinion = EXCLUDED.second_opinion, fee_amount = EXCLUDED.fee_amount,
           fee_currency = EXCLUDED.fee_currency, typical_wait_days = EXCLUDED.typical_wait_days`,
        [
          d.id,
          d.facilityId,
          d.specialtyCode,
          d.nameEn,
          d.nameAr,
          d.focusEn,
          d.focusAr,
          d.yearsExperience,
          d.languages,
          d.inPerson,
          d.telemedicine,
          d.secondOpinion,
          d.feeAmount,
          d.feeCurrency,
          d.typicalWaitDays,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error("Seeding failed", { cause: error });
  }
}

export async function setupDatabase(connectionString: string): Promise<string[]> {
  const pool = createPool(connectionString);
  const client = await pool.connect();
  try {
    const applied = await migrate(client);
    await seed(client);
    return applied;
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const applied = await setupDatabase(url);
  console.log(
    `Database ready. Migrations applied: ${applied.length > 0 ? applied.join(", ") : "none pending"}. ` +
      `Seeded ${specialties.length} specialties, ${facilities.length} facilities, ${doctors.length} doctors.`,
  );
}
