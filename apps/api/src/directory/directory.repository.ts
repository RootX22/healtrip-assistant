import type { City, DoctorListing, DoctorQuery, Specialty } from "./types.js";

/**
 * Read access to the care directory. Two implementations share one contract
 * and one test suite: Postgres for real deployments, in-memory for running
 * without a database and for fast tests.
 */
export interface DirectoryRepository {
  readonly kind: "postgres" | "in-memory";
  listSpecialties(): Promise<Specialty[]>;
  listCities(): Promise<City[]>;
  listLanguages(): Promise<string[]>;
  listCountries(): Promise<string[]>;
  /** Ordered by shortest wait, then experience; capped at query.limit. */
  search(query: DoctorQuery): Promise<DoctorListing[]>;
  /** Returns listings in the order of `ids`, silently skipping unknown ids. */
  findByIds(ids: readonly string[]): Promise<DoctorListing[]>;
  /** Every doctor and facility name, in both languages. */
  listNames(): Promise<string[]>;
  ping(): Promise<void>;
}

export const DIRECTORY_REPOSITORY = Symbol("DIRECTORY_REPOSITORY");
