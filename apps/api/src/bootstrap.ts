import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import type { AppConfig } from "./config/config.js";
import { requestId } from "./common/request-id.js";

/** HTTP setup shared by the server and the end-to-end tests, so the tests exercise the real thing. */
export function configureHttp(app: NestExpressApplication, config: AppConfig): void {
  // Behind the web app's proxy every request would otherwise share one address
  // and one rate-limit bucket.
  app.set("trust proxy", config.trustProxyHops);
  // First, so that even a request the body parser rejects carries an id back.
  app.use(requestId);
  app.use(helmet());
  app.useBodyParser("json", { limit: "16kb" });
  app.enableCors({ origin: config.corsOrigin, methods: ["GET", "POST"] });
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();
}
