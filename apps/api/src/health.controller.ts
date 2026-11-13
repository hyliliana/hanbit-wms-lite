import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { Public } from "./auth";

@Public()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  root() {
    return { name: "한빛 WMS Lite 처리 서버", health: "/health" };
  }

  // 처리 서버가 켜져 있는지, DB와 연결되는지 확인한다
  @Get("health")
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "connected" };
    } catch {
      return { status: "ok", db: "disconnected" };
    }
  }
}
