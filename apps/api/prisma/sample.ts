// 가상 데이터 넣기: 기존 데이터를 지우고 화주사 3곳·사용자·품목·작업지시·재고·문서(v1)를 넣는다.
// FROZEN 지침서 v2(개정판)는 넣지 않는다 → 시연 때 관리자 화면에서 업로드해 "바뀐 조항"을 보여 준다.
// 데모 계정 비밀번호는 모두 DEMO_PASSWORD (기본 demo1234).
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { hashPassword } from "../src/auth";
import { AiService, splitSections } from "../src/ai.service";

const prisma = new PrismaClient();
const ai = new AiService(prisma as any);
const PW = process.env.DEMO_PASSWORD || "demo1234";
const day = (n: number) => new Date(Date.now() + n * 86400e3);

async function main() {
  await prisma.docChunk.deleteMany();
  await prisma.document.deleteMany();
  await prisma.damageReport.deleteMany();
  await prisma.stockLot.deleteMany();
  await prisma.workOrder.deleteMany();
  await prisma.item.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.shipper.deleteMany();

  const fresh = await prisma.shipper.create({ data: { code: "FRESH", name: "신선마켓" } });
  const beauty = await prisma.shipper.create({ data: { code: "BEAUTY", name: "루미코스메틱" } });
  const frozen = await prisma.shipper.create({ data: { code: "FROZEN", name: "한겨울푸드" } });

  const h = hashPassword(PW);
  const mk = (loginId: string, name: string, role: any, shipperId: number | null = null) =>
    prisma.user.create({ data: { loginId, name, role, shipperId, passwordHash: h } });
  await mk("center", "센터장", "ADMIN");
  await mk("choi", "최 과장", "MANAGER");
  await mk("kim", "관리자 김", "MANAGER");
  const jang = await mk("jang", "장 씨 (냉장)", "WORKER");
  const nguyen = await mk("nguyen", "응우옌 (냉동)", "WORKER");
  await mk("fresh", "신선마켓 담당자", "SHIPPER", fresh.id);
  await mk("beauty", "루미코스메틱 담당자", "SHIPPER", beauty.id);
  await mk("frozen", "한겨울푸드 담당자", "SHIPPER", frozen.id);

  const item = (shipperId: number, sku: string, name: string, zone: any) => prisma.item.create({ data: { shipperId, sku, name, zone } });
  const milk = await item(fresh.id, "F-MILK-1L", "유기농 우유 1L (12개입)", "CHILLED");
  const yog = await item(fresh.id, "F-YOG-4", "그릭요거트 4입", "CHILLED");
  const cream = await item(beauty.id, "B-CRM-50", "수분크림 50ml (24개입)", "AMBIENT");
  const serum = await item(beauty.id, "B-SRM-30", "비타민 세럼 30ml", "AMBIENT");
  const dump = await item(frozen.id, "Z-DMP-1K", "냉동 만두 1kg (10개입)", "FROZEN");
  const ice = await item(frozen.id, "Z-ICE-6", "아이스크림 6입", "FROZEN");

  // 완료된 입고 (재고 생성, 1건은 수량 차이)
  const done = async (it: any, exp: number, act: number, loc: string, lot: string, expiry: Date | null, who: number) => {
    const w = await prisma.workOrder.create({
      data: { shipperId: it.shipperId, itemId: it.id, expectedQty: exp, actualQty: act, location: loc, lotNo: lot, expiryDate: expiry, status: "DONE", assigneeId: who, completedAt: day(-1) },
    });
    await prisma.stockLot.create({ data: { shipperId: it.shipperId, itemId: it.id, workOrderId: w.id, location: loc, lotNo: lot, qty: act, expiryDate: expiry, receivedAt: day(-1) } });
  };
  await done(milk, 40, 40, "C-01-02", "FM1110", day(9), jang.id);
  await done(cream, 120, 118, "A-03-01", "BC1110", day(400), jang.id);
  await done(dump, 60, 60, "Z-02-04", "ZD1109", day(180), nguyen.id);

  // 오늘 예정된 입고
  const plan = (it: any, exp: number, loc: string, lot: string, expiry: Date | null, who: number | null) =>
    prisma.workOrder.create({ data: { shipperId: it.shipperId, itemId: it.id, expectedQty: exp, location: loc, lotNo: lot, expiryDate: expiry, assigneeId: who } });
  await plan(milk, 30, "C-01-03", "FM1113", day(10), jang.id);
  await plan(yog, 24, "C-02-01", "FY1113", day(14), jang.id);
  await plan(serum, 50, "A-03-02", "BS1113", day(500), null);
  await plan(ice, 40, "Z-03-01", "ZI1113", day(240), nguyen.id);
  await plan(dump, 20, "Z-02-05", "ZD1113", day(181), nguyen.id);

  // 문서 v1 (지침서·계약서)
  const dir = join(__dirname, "seed-docs");
  const docs: [number, "GUIDE" | "CONTRACT", string][] = [
    [fresh.id, "GUIDE", "FRESH_취급지침서_v1.md"],
    [fresh.id, "CONTRACT", "FRESH_보관계약서.md"],
    [beauty.id, "GUIDE", "BEAUTY_취급지침서_v1.md"],
    [beauty.id, "CONTRACT", "BEAUTY_보관계약서.md"],
    [frozen.id, "GUIDE", "FROZEN_취급지침서_v1.md"],
    [frozen.id, "CONTRACT", "FROZEN_보관계약서.md"],
  ];
  for (const [shipperId, kind, file] of docs) {
    const content = readFileSync(join(dir, file), "utf8");
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file;
    const sections = splitSections(content);
    const embeds = await ai.embed(sections.map((s) => `${title} ${s.section}\n${s.text}`));
    await prisma.document.create({
      data: {
        shipperId, kind, title, version: 1, isCurrent: true,
        chunks: { create: sections.map((s, i) => ({ order: i, section: s.section, text: s.text, embedding: embeds[i] ?? [] })) },
      },
    });
    console.log(`문서 ${file}: 조항 ${sections.length}개, 임베딩 ${embeds[0]?.length ? "있음" : "없음(키워드 검색)"}`);
  }
  console.log("가상 데이터를 넣었습니다.");
}

main().finally(() => prisma.$disconnect());
