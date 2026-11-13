import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaService } from "./prisma.service";
import { HealthController } from "./health.controller";
import { WmsController } from "./wms.controller";
import { InquiryController } from "./inquiry.controller";
import { AiService } from "./ai.service";
import { AuthGuard } from "./auth";

@Module({
  controllers: [HealthController, WmsController, InquiryController],
  providers: [PrismaService, AiService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
