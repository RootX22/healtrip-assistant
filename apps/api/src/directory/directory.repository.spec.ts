// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../database/pool.js";
import { setupDatabase } from "../database/setup.js";
import type { DirectoryRepository } from "./directory.repository.js";
import { InMemoryDirectoryRepository } from "./in-memory-directory.repository.js";
import { PostgresDirectoryRepository } from "./postgres-directory.repository.js";
import type { DoctorQuery } from "./types.js";

const databaseUrl = process.env.DATABASE_URL;

interface Target {
  name: string;
  open: () => Promise<DirectoryRepository>;
  close: (repo: DirectoryRepository) => Promise<void>;
}

const targets: Target[] = [
  {
    name: "in-memory",
    open: async () => new InMemoryDirectoryRepository(),
    close: async () => {},
  },
];

// The SQL has to agree with the in-memory rules, so both answer the same cases.
if (databaseUrl) {
  targets.push({
    name: "postgres",
    open: async () => {
      await setupDatabase(databaseUrl);
      return new PostgresDirectoryRepository(createPool(databaseUrl));
    },
    close: async (repo) => (repo as PostgresDirectoryRepository).onApplicationShutdown(),
  });
}

const ids = async (repo: DirectoryRepository, query: Omit<DoctorQuery, "limit">) =>
  (await repo.search({ limit: 5, ...query })).map((l) => l.doctor.id);

describe.each(targets)("$name directory", (target) => {
  let repo: DirectoryRepository;
  beforeAll(async () => {
    repo = await target.open();
  });
  afterAll(async () => target.close(repo));

  it("orders a city search by shortest wait", async () => {
    expect(await ids(repo, { specialty: "cardiology", city: "Riyadh" })).toEqual([
      "doc_sara_otaibi",
      "doc_khalid_harbi",
    ]);
  });

  it("resolves the city however it is written", async () => {
    for (const city of ["riyadh", "الرياض", "بالرياض"]) {
      expect(await ids(repo, { specialty: "cardiology", city })).toEqual([
        "doc_sara_otaibi",
        "doc_khalid_harbi",
      ]);
    }
  });

  it("returns nothing for a city the directory does not cover", async () => {
    expect(await ids(repo, { specialty: "cardiology", city: "Mecca" })).toEqual([]);
  });

  it("filters by service", async () => {
    expect(
      await ids(repo, { specialty: "cardiology", city: "Riyadh", service: "second_opinion" }),
    ).toEqual(["doc_sara_otaibi"]);
  });

  it("lets a virtual clinic answer a city search only for telemedicine", async () => {
    expect(
      await ids(repo, { specialty: "family_medicine", city: "Riyadh", service: "telemedicine" }),
    ).toEqual(["doc_noura_shehri"]);
    expect(
      await ids(repo, { specialty: "family_medicine", city: "Riyadh", service: "in_person" }),
    ).toEqual([]);
    expect(
      await ids(repo, { specialty: "family_medicine", city: "Mecca", service: "telemedicine" }),
    ).toEqual(["doc_noura_shehri"]);
  });

  it("filters by language and country", async () => {
    expect(await ids(repo, { specialty: "cardiology", language: "fr" })).toEqual([
      "doc_lina_haddad",
    ]);
    expect(await ids(repo, { specialty: "cardiology", country: "tr" })).toEqual([
      "doc_emre_yilmaz",
    ]);
  });

  it("honours the limit", async () => {
    expect(await repo.search({ specialty: "cardiology", limit: 2 })).toHaveLength(2);
  });

  it("returns listings in the order asked and skips unknown ids", async () => {
    const found = await repo.findByIds(["doc_lina_haddad", "doc_unknown", "doc_sara_otaibi"]);
    expect(found.map((l) => l.doctor.id)).toEqual(["doc_lina_haddad", "doc_sara_otaibi"]);
    expect(found[0]?.facility.cityEn).toBe("Jeddah");
    expect(found[0]?.specialty.nameAr).toBe("أمراض القلب");
  });

  it("lists every name in both languages", async () => {
    const names = await repo.listNames();
    expect(names).toContain("Dr. Sara Al-Otaibi");
    expect(names).toContain("مركز النخيل للقلب");
  });

  it("lists cities, languages and countries", async () => {
    expect((await repo.listCities()).map((c) => c.en)).toEqual([
      "Cairo",
      "Dammam",
      "Dubai",
      "Istanbul",
      "Jeddah",
      "Riyadh",
    ]);
    expect(await repo.listLanguages()).toEqual(["ar", "en", "fr", "hi", "tr", "ur"]);
    expect(await repo.listCountries()).toEqual(["AE", "EG", "SA", "TR"]);
  });
});
