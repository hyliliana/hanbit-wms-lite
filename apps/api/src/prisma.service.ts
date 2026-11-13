import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    try {
      await this.$connect();
    } catch {
      console.error("DB에 연결하지 못했습니다. apps/api/.env의 DATABASE_URL을 확인하세요.");
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
