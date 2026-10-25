// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { Controller, Get, Inject, Module, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { AgentService } from "../agent/agent.service.js";
import { AgentModule } from "../agent/agent.module.js";
import { DirectoryModule } from "../directory/directory.module.js";
import {
  DIRECTORY_REPOSITORY,
  type DirectoryRepository,
} from "../directory/directory.repository.js";

@Controller("health")
@SkipThrottle()
export class HealthController {
  constructor(
    @Inject(DIRECTORY_REPOSITORY) private readonly directory: DirectoryRepository,
    private readonly agent: AgentService,
  ) {}

  /** 503 when the directory cannot be reached: a load balancer should stop sending patients here. */
  @Get()
  async check(@Res({ passthrough: true }) response: Response) {
    let database: "up" | "down" | "not_configured" = "not_configured";
    if (this.directory.kind === "postgres") {
      try {
        await this.directory.ping();
        database = "up";
      } catch {
        database = "down";
      }
    }
    const healthy = database !== "down";
    response.status(healthy ? 200 : 503);
    return {
      status: healthy ? "ok" : "degraded",
      engine: this.agent.engine,
      directory: this.directory.kind,
      database,
    };
  }
}

@Module({
  imports: [DirectoryModule, AgentModule],
  controllers: [HealthController],
})
export class HealthModule {}
