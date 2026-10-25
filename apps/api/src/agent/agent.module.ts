import { Module } from "@nestjs/common";
import { DirectoryModule } from "../directory/directory.module.js";
import {
  DIRECTORY_REPOSITORY,
  type DirectoryRepository,
} from "../directory/directory.repository.js";
import { LlmModule } from "../llm/llm.module.js";
import { AGENT_TOOLKIT, AgentService, NAME_INDEX } from "./agent.service.js";
import { NameIndex } from "./grounding.js";
import { buildToolkit } from "./tools.js";

@Module({
  imports: [DirectoryModule, LlmModule],
  providers: [
    AgentService,
    {
      provide: AGENT_TOOLKIT,
      inject: [DIRECTORY_REPOSITORY],
      useFactory: (directory: DirectoryRepository) => buildToolkit(directory),
    },
    {
      provide: NAME_INDEX,
      inject: [DIRECTORY_REPOSITORY],
      useFactory: async (directory: DirectoryRepository) =>
        new NameIndex(await directory.listNames()),
    },
  ],
  exports: [AgentService],
})
export class AgentModule {}
