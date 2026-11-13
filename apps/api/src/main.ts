import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // 파손 사진(축소본)을 받을 수 있게 본문 크기를 늘린다
  const express = require("express");
  app.use(express.json({ limit: "3mb" }));

  // 처리 서버는 여기에 적힌 화면 주소에서 온 요청만 받는다 (CORS)
  const allowed = (process.env.ALLOWED_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowed });

  // Render는 PORT 환경변수로 포트를 정해 준다
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  console.log(`처리 서버가 켜졌습니다: http://localhost:${port}`);
}
bootstrap();
