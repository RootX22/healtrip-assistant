import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { ConfigModule } from "./config/config.js";
import { ConversationsModule } from "./conversations/conversations.module.js";
import { DirectoryModule } from "./directory/directory.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DirectoryModule,
    ConversationsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
