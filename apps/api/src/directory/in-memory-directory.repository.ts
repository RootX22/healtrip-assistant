import type { DirectoryRepository } from "./directory.repository.js";
import { bySuitability, matches, resolveCity } from "./query.js";
import * as seed from "./seed-data.js";
import type { City, Doctor, DoctorListing, DoctorQuery, Facility, Specialty } from "./types.js";

interface DirectoryData {
  specialties: Specialty[];
  facilities: Facility[];
  doctors: Doctor[];
}

/** The seed data held in memory: no database needed to run or test the service. */
export class InMemoryDirectoryRepository implements DirectoryRepository {
  readonly kind = "in-memory" as const;
  private readonly listings: DoctorListing[];

  constructor(private readonly data: DirectoryData = seed) {
    const facilityById = new Map(data.facilities.map((f) => [f.id, f]));
    const specialtyByCode = new Map(data.specialties.map((s) => [s.code, s]));
    this.listings = data.doctors.map((doctor) => {
      const facility = facilityById.get(doctor.facilityId);
      const specialty = specialtyByCode.get(doctor.specialtyCode);
      if (!facility || !specialty) {
        throw new Error(`Seed data is inconsistent for doctor ${doctor.id}`);
      }
      return { doctor, facility, specialty };
    });
  }

  async listSpecialties(): Promise<Specialty[]> {
    return [...this.data.specialties].sort((a, b) => a.code.localeCompare(b.code));
  }

  async listCities(): Promise<City[]> {
    const cities = new Map<string, City>();
    for (const f of this.data.facilities) {
      if (f.cityEn && f.cityAr)
        cities.set(f.cityEn, { en: f.cityEn, ar: f.cityAr, countryCode: f.countryCode });
    }
    return [...cities.values()].sort((a, b) => a.en.localeCompare(b.en));
  }

  async listLanguages(): Promise<string[]> {
    return [...new Set(this.data.doctors.flatMap((d) => d.languages))].sort();
  }

  async listCountries(): Promise<string[]> {
    return [...new Set(this.data.facilities.map((f) => f.countryCode))].sort();
  }

  async search(query: DoctorQuery): Promise<DoctorListing[]> {
    const city =
      query.city === undefined ? undefined : resolveCity(query.city, await this.listCities());
    return this.listings
      .filter(({ doctor, facility }) => matches(doctor, facility, query, city))
      .sort(bySuitability)
      .slice(0, query.limit);
  }

  async findByIds(ids: readonly string[]): Promise<DoctorListing[]> {
    const byId = new Map(this.listings.map((l) => [l.doctor.id, l]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  async listNames(): Promise<string[]> {
    return [
      ...this.data.doctors.flatMap((d) => [d.nameEn, d.nameAr]),
      ...this.data.facilities.flatMap((f) => [f.nameEn, f.nameAr]),
    ];
  }

  async ping(): Promise<void> {}
}
