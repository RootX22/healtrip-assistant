import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { DirectoryModule } from "../directory/directory.module.js";
import {
  DIRECTORY_REPOSITORY,
  type DirectoryRepository,
} from "../directory/directory.repository.js";
import { AnthropicModelClient } from "./anthropic.model-client.js";
import { MODEL_CLIENT, type ModelClient } from "./model-client.js";
import { RuleBasedModelClient } from "./rule-based.model-client.js";

@Module({
  imports: [DirectoryModule],
  providers: [
    {
      provide: MODEL_CLIENT,
      inject: [APP_CONFIG, DIRECTORY_REPOSITORY],
      useFactory: async (
        config: AppConfig,
        directory: DirectoryRepository,
      ): Promise<ModelClient> =>
        config.engine === "claude"
          ? AnthropicModelClient.fromConfig(config)
          : new RuleBasedModelClient(await directory.listCities()),
    },
  ],
  exports: [MODEL_CLIENT],
})
export class LlmModule {}
