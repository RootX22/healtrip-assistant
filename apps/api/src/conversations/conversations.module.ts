import { Body, Controller, HttpCode, Module, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  type AssistantTurn,
  type Conversation,
  type CreateConversationRequest,
  createConversationRequestSchema,
  type SendMessageRequest,
  sendMessageRequestSchema,
} from "@healtrip/contracts";
import { z } from "zod";
import { AgentModule } from "../agent/agent.module.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { DirectoryModule } from "../directory/directory.module.js";
import { InMemoryConversationStore } from "./conversation.store.js";
import { ConversationsService } from "./conversations.service.js";

@Controller("v1/conversations")
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Body(new ZodValidationPipe(createConversationRequestSchema)) body: CreateConversationRequest,
  ): Conversation {
    return this.conversations.create(body.locale);
  }

  // Each message can cost several model calls, so it gets the tightest limit.
  @Post(":id/messages")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  send(
    @Param("id", new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(sendMessageRequestSchema)) body: SendMessageRequest,
  ): Promise<AssistantTurn> {
    return this.conversations.send(id, body);
  }
}

@Module({
  imports: [AgentModule, DirectoryModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    {
      provide: InMemoryConversationStore,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new InMemoryConversationStore(config.conversationTtlMs),
    },
  ],
})
export class ConversationsModule {}
