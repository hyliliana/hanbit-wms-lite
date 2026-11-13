import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaService } from "./prisma.service";
import { HealthController } from "./health.controller";
import { WmsController } from "./wms.controller";
import { AiService } from "./ai.service";
import { AuthGuard } from "./auth";

@Module({
  controllers: [HealthController, WmsController],
  providers: [PrismaService, AiService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
