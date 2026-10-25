// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { Controller, Get, Inject, Module, Query } from "@nestjs/common";
import {
  type DoctorSearchQuery,
  doctorSearchQuerySchema,
  type Locale,
  localeSchema,
  type ProviderCard,
  type Specialty,
} from "@healtrip/contracts";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { createPool } from "../database/pool.js";
import { DIRECTORY_REPOSITORY, type DirectoryRepository } from "./directory.repository.js";
import { InMemoryDirectoryRepository } from "./in-memory-directory.repository.js";
import { PostgresDirectoryRepository } from "./postgres-directory.repository.js";
import { toProviderCard } from "./provider-card.js";

const SEARCH_LIMIT = 10;

/**
 * The directory, readable directly. The agent searches the same repository
 * through its tools; exposing it here lets anyone check a recommendation
 * against the source.
 */
@Controller("v1")
export class DirectoryController {
  constructor(@Inject(DIRECTORY_REPOSITORY) private readonly directory: DirectoryRepository) {}

  @Get("specialties")
  async specialties(
    @Query("locale", new ZodValidationPipe(localeSchema.default("en"))) locale: Locale,
  ): Promise<{ specialties: Specialty[] }> {
    const all = await this.directory.listSpecialties();
    return {
      specialties: all.map((s) => ({ code: s.code, name: locale === "ar" ? s.nameAr : s.nameEn })),
    };
  }

  @Get("doctors")
  async doctors(
    @Query(new ZodValidationPipe(doctorSearchQuerySchema)) query: DoctorSearchQuery,
  ): Promise<{ results: ProviderCard[] }> {
    const { locale, ...filters } = query;
    const listings = await this.directory.search({ ...filters, limit: SEARCH_LIMIT });
    return { results: listings.map((l) => toProviderCard(l, locale)) };
  }
}

@Module({
  controllers: [DirectoryController],
  providers: [
    {
      provide: DIRECTORY_REPOSITORY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DirectoryRepository =>
        config.databaseUrl
          ? new PostgresDirectoryRepository(createPool(config.databaseUrl))
          : new InMemoryDirectoryRepository(),
    },
  ],
  exports: [DIRECTORY_REPOSITORY],
})
export class DirectoryModule {}
