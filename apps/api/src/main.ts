// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureHttp } from "./bootstrap.js";
import { APP_CONFIG, type AppConfig } from "./config/config.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
const config = app.get<AppConfig>(APP_CONFIG);
configureHttp(app, config);
await app.listen(config.port);

const directory = config.databaseUrl ? "postgres" : "in-memory";
Logger.log(
  `Listening on :${config.port} — engine ${config.engine}, directory ${directory}`,
  "bootstrap",
);
