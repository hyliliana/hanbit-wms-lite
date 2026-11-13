import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "./prisma.service";
import { AiService, splitSections } from "./ai.service";
import { AuthUser, Public, Roles, checkPassword, scopeShipper } from "./auth";

const STAFF = ["ADMIN", "MANAGER", "WORKER"] as const;
const OFFICE = ["ADMIN", "MANAGER"] as const;

/** 인터뷰(장 씨): "파손 보고는 관리자가 30분 안에는 확인해야 해요" */
const DAMAGE_SLA_MIN = 30;

/** 한국 시간 기준 그날 23:59:59 */
function endOfDayKst(d: Date) {
  const k = new Date(d.getTime() + 9 * 3600e3);
  k.setUTCHours(23, 59, 59, 0);
  return new Date(k.getTime() - 9 * 3600e3);
}

const int = (v: any) => (v === undefined || v === null || v === "" ? undefined : Number(v));

@Controller()
export class WmsController {
  constructor(private prisma: PrismaService, private ai: AiService) {}

  // ───────── 로그인 ─────────
  @Public()
  @Post("auth/login")
  async login(@Body() b: { loginId: string; password: string }) {
    const u = await this.prisma.user.findUnique({ where: { loginId: b?.loginId ?? "" }, include: { shipper: true } });
    if (!u || !checkPassword(b.password ?? "", u.passwordHash)) throw new UnauthorizedException("아이디 또는 비밀번호가 맞지 않습니다");
    const token = randomBytes(24).toString("hex");
    await this.prisma.session.create({ data: { token, userId: u.id, expiresAt: new Date(Date.now() + 12 * 3600e3) } });
    return { token, user: { id: u.id, name: u.name, role: u.role, shipperId: u.shipperId, shipperName: u.shipper?.name ?? null } };
  }

  @Public()
  @Get("auth/demo-accounts")
  async demoAccounts() {
    const us = await this.prisma.user.findMany({ include: { shipper: true }, orderBy: { id: "asc" } });
    return us.map((u) => ({ loginId: u.loginId, name: u.name, role: u.role, shipper: u.shipper?.name ?? null }));
  }

  @Get("me")
  me(@Req() req: any) {
    return req.user;
  }

  // ───────── 화주사·품목 ─────────
  @Get("shippers")
  async shippers(@Req() req: any) {
    const u: AuthUser = req.user;
    const where = u.role === "SHIPPER" ? { id: u.shipperId! } : {};
    return this.prisma.shipper.findMany({ where, orderBy: { id: "asc" } });
  }

  @Get("items")
  async items(@Req() req: any, @Query("shipperId") sid?: string) {
    const shipperId = scopeShipper(req.user, int(sid));
    return this.prisma.item.findMany({ where: { shipperId }, orderBy: { id: "asc" } });
  }

  // ───────── 입고 작업지시 ─────────
  @Get("work-orders")
  async workOrders(@Req() req: any, @Query("shipperId") sid?: string, @Query("status") status?: string) {
    const u: AuthUser = req.user;
    const shipperId = scopeShipper(u, int(sid));
    const where: any = { shipperId };
    if (status === "PLANNED" || status === "DONE") where.status = status;
    if (u.role === "WORKER") where.OR = [{ assigneeId: u.id }, { assigneeId: null }];
    const rows = await this.prisma.workOrder.findMany({
      where,
      include: { item: true, shipper: true, assignee: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    const out = rows.map((w) => ({ ...w, diff: w.actualQty === null ? null : w.actualQty - w.expectedQty }));
    // 화주사: 입고 완료 여부·시각·수량 차이만. 보관 위치·작업자·센터 메모 제외
    if (u.role === "SHIPPER") return out.map(({ location, assignee, assigneeId, note, ...r }) => r);
    return out;
  }

  @Roles(...OFFICE)
  @Post("work-orders")
  async createWorkOrder(@Body() b: any) {
    const item = await this.prisma.item.findUnique({ where: { id: Number(b.itemId) } });
    if (!item) throw new BadRequestException("품목을 고르세요");
    const qty = Number(b.expectedQty);
    if (!Number.isInteger(qty) || qty <= 0) throw new BadRequestException("예정 수량은 1 이상 정수여야 합니다");
    if (!b.location) throw new BadRequestException("보관 위치를 입력하세요");
    return this.prisma.workOrder.create({
      data: {
        shipperId: item.shipperId,
        itemId: item.id,
        expectedQty: qty,
        location: String(b.location),
        lotNo: b.lotNo || `L${Date.now().toString().slice(-6)}`,
        expiryDate: b.expiryDate ? new Date(b.expiryDate) : null,
        assigneeId: int(b.assigneeId) ?? null,
      },
    });
  }

  /** 작업자가 실제 수량을 넣고 완료 → 재고 생성. 실제 수량 없이 완료 불가 */
  @Roles(...STAFF)
  @Post("work-orders/:id/complete")
  async complete(@Req() req: any, @Param("id", ParseIntPipe) id: number, @Body() b: any) {
    const u: AuthUser = req.user;
    const actual = Number(b?.actualQty);
    if (b?.actualQty === undefined || b?.actualQty === "" || !Number.isInteger(actual) || actual < 0)
      throw new BadRequestException("실제 수량(0 이상 정수)을 입력해야 완료할 수 있습니다");
    return this.prisma.$transaction(async (tx) => {
      const w = await tx.workOrder.findUnique({ where: { id } });
      if (!w) throw new NotFoundException("작업지시가 없습니다");
      if (w.status === "DONE") throw new BadRequestException("이미 완료된 작업입니다");
      if (u.role === "WORKER" && w.assigneeId && w.assigneeId !== u.id) throw new ForbiddenException("다른 작업자에게 배정된 작업입니다");
      const done = await tx.workOrder.update({
        where: { id },
        data: { actualQty: actual, status: "DONE", completedAt: new Date(), assigneeId: w.assigneeId ?? u.id, note: b.note || null },
      });
      if (actual > 0) {
        await tx.stockLot.create({
          data: { shipperId: w.shipperId, itemId: w.itemId, workOrderId: w.id, location: w.location, lotNo: w.lotNo, qty: actual, expiryDate: w.expiryDate },
        });
      }
      return { ...done, diff: actual - w.expectedQty };
    });
  }

  // ───────── 재고 (화주사는 자기 것만) ─────────
  @Get("stock")
  async stock(@Req() req: any, @Query("shipperId") sid?: string) {
    const shipperId = scopeShipper(req.user, int(sid));
    const rows = await this.prisma.stockLot.findMany({
      where: { shipperId, qty: { gt: 0 } },
      include: { item: true, shipper: true },
      orderBy: [{ shipperId: "asc" }, { expiryDate: "asc" }],
    });
    // 2차 인터뷰(최 과장): 보관 위치 공개 여부 미정 → 화주사에게는 보내지 않는다
    if (req.user.role === "SHIPPER") return rows.map(({ location, ...r }) => r);
    return rows;
  }

  // ───────── 파손 보고 ─────────
  @Roles(...STAFF)
  @Post("damages")
  async reportDamage(@Req() req: any, @Body() b: any) {
    const u: AuthUser = req.user;
    const shipper = await this.prisma.shipper.findUnique({ where: { id: Number(b.shipperId) } });
    if (!shipper) throw new BadRequestException("화주사를 고르세요");
    if (!b.description?.trim()) throw new BadRequestException("어떤 파손인지 적어 주세요");
    // 2차 인터뷰(센터장): 사진·발견 시각·입고 물건 식별은 꼭 필요 (발견 시각 = 보고 시각, 서버가 자동 기록)
    if (!b.photo || !String(b.photo).startsWith("data:image/")) throw new BadRequestException("파손 사진을 첨부해야 보고할 수 있습니다");
    if (String(b.photo).length > 1_500_000) throw new BadRequestException("사진이 너무 큽니다");
    if (!int(b.itemId) && !int(b.workOrderId)) throw new BadRequestException("어떤 입고 물건인지(품목 또는 작업지시) 골라야 합니다");
    const itemId = int(b.itemId);
    if (itemId) {
      const it = await this.prisma.item.findUnique({ where: { id: itemId } });
      if (!it || it.shipperId !== shipper.id) throw new BadRequestException("이 화주사의 품목이 아닙니다");
    }
    // 보고 순간 그 화주사 지침서에서 파손 처리 방법을 찾아 붙인다 (판단은 관리자)
    const q = `파손 입고 시 처리 방법과 보고 기한, 사진 기준, 파손 책임. 상황: ${b.description}`;
    const cites = await this.ai.search(shipper.id, q, 3);
    const ans = await this.ai.answer(shipper.name, `이 파손을 어떻게 처리해야 하나요? 상황: ${b.description}`, cites);
    // 통보 기한: 현행 지침서의 '파손' 조항에서 "N시간 안에"를 그대로 읽는다 (AI 추정 아님)
    // 근거: 보관계약서 제6조 — 지침서 기한 안에 통보하지 않으면 늘어난 손해를 센터가 부담
    const notify = await this.notifyDeadline(shipper.id);
    const now = new Date();
    return this.prisma.damageReport.create({
      data: {
        shipperId: shipper.id,
        itemId: itemId ?? null,
        workOrderId: int(b.workOrderId) ?? null,
        reporterId: u.id,
        qty: Math.max(1, Number(b.qty) || 1),
        description: b.description.trim(),
        photo: b.photo || null,
        aiGuidance: ans.answer,
        aiCitations: cites.map((c) => ({ title: c.title, version: c.version, section: c.section, text: c.text })),
        notifyHours: notify?.hours ?? null,
        notifyDueAt: notify ? (notify.hours ? new Date(now.getTime() + notify.hours * 3600e3) : endOfDayKst(now)) : null,
        notifySource: notify?.source ?? null,
      },
    });
  }

  private async notifyDeadline(shipperId: number) {
    const chunks = await this.prisma.docChunk.findMany({
      where: { document: { shipperId, kind: "GUIDE", isCurrent: true }, section: { contains: "파손" } },
      include: { document: true },
      orderBy: { order: "asc" },
    });
    for (const c of chunks) {
      const source = `${c.document.title.split(" (")[0]} 제${c.document.version}판 · ${c.section}`;
      const m = c.text.match(/(\d+)\s*시간\s*(?:안|이내)/);
      if (m) return { hours: Number(m[1]), source };
      if (/당일\s*(?:안|이내|중)/.test(c.text)) return { hours: null as number | null, source: `${source} (발견 당일)` };
    }
    return null;
  }

  @Get("damages")
  async damages(@Req() req: any, @Query("status") status?: string, @Query("shipperId") sid?: string) {
    const u: AuthUser = req.user;
    const shipperId = scopeShipper(u, int(sid));
    const where: any = { shipperId };
    if (status === "REPORTED" || status === "CONFIRMED") where.status = status;
    if (u.role === "WORKER") where.reporterId = u.id;
    const rows = await this.prisma.damageReport.findMany({
      where,
      include: { shipper: true, item: true, reporter: { select: { name: true } }, confirmedBy: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    // 화주사에게는 센터 내부 처리 지침(AI 첨부·근거 원문)을 내려보내지 않는다
    if (u.role === "SHIPPER") return rows.map(({ aiGuidance, aiCitations, notifySource, managerNote, confirmedBy, confirmedById, notifiedById, ...r }) => r);
    return rows;
  }

  @Roles(...OFFICE)
  @Post("damages/:id/confirm")
  async confirmDamage(@Req() req: any, @Param("id", ParseIntPipe) id: number, @Body() b: any) {
    const d = await this.prisma.damageReport.findUnique({ where: { id } });
    if (!d) throw new NotFoundException("보고가 없습니다");
    if (d.status === "CONFIRMED") throw new BadRequestException("이미 확인한 보고입니다");
    return this.prisma.damageReport.update({
      where: { id },
      data: {
        status: "CONFIRMED", confirmedById: req.user.id, confirmedAt: new Date(), managerNote: b?.managerNote || null,
        ...(b?.notified ? { notifiedAt: new Date(), notifiedById: req.user.id } : {}),
      },
    });
  }

  /** 화주사 통보 완료 기록 (확인 뒤에 따로 기록할 수도 있음) */
  @Roles(...OFFICE)
  @Post("damages/:id/notified")
  async markNotified(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    const d = await this.prisma.damageReport.findUnique({ where: { id } });
    if (!d) throw new NotFoundException("보고가 없습니다");
    if (d.notifiedAt) throw new BadRequestException("이미 통보 완료로 기록했습니다");
    return this.prisma.damageReport.update({ where: { id }, data: { notifiedAt: new Date(), notifiedById: req.user.id } });
  }

  // ───────── 관리자 요약 ─────────
  @Roles(...OFFICE)
  @Get("dashboard")
  async dashboard() {
    const [unconfirmed, overdue, notifyOverdue, planned, doneWithDiff] = await Promise.all([
      this.prisma.damageReport.count({ where: { status: "REPORTED" } }),
      this.prisma.damageReport.count({ where: { status: "REPORTED", createdAt: { lt: new Date(Date.now() - DAMAGE_SLA_MIN * 60e3) } } }),
      this.prisma.damageReport.count({ where: { notifiedAt: null, notifyDueAt: { lt: new Date() } } }),
      this.prisma.workOrder.count({ where: { status: "PLANNED" } }),
      this.prisma.workOrder.findMany({ where: { status: "DONE" }, select: { expectedQty: true, actualQty: true } }),
    ]);
    return { unconfirmedDamages: unconfirmed, overdueDamages: overdue, notifyOverdue, damageSlaMinutes: DAMAGE_SLA_MIN, plannedOrders: planned, qtyMismatches: doneWithDiff.filter((w) => w.actualQty !== w.expectedQty).length };
  }

  // ───────── 문서 (지침서·계약서) ─────────
  @Roles(...STAFF)
  @Get("documents")
  async documents(@Query("shipperId") sid?: string) {
    return this.prisma.document.findMany({
      where: { shipperId: int(sid) },
      include: { shipper: true, _count: { select: { chunks: true, acks: true } } },
      orderBy: [{ shipperId: "asc" }, { kind: "asc" }, { version: "desc" }],
    });
  }

  @Roles(...STAFF)
  @Get("documents/:id")
  async document(@Param("id", ParseIntPipe) id: number) {
    const d = await this.prisma.document.findUnique({
      where: { id },
      include: { shipper: true, chunks: { orderBy: { order: "asc" }, select: { section: true, text: true } } },
    });
    if (!d) throw new NotFoundException();
    return d;
  }

  /** 새 판 업로드: 현행 1개 유지, 예전 판 보관, 바뀐 조항 계산 */
  @Roles(...OFFICE)
  @Post("documents")
  async upload(@Body() b: any) {
    const shipperId = Number(b.shipperId);
    const kind = b.kind === "CONTRACT" ? "CONTRACT" : "GUIDE";
    const content = String(b.content ?? "");
    const sections = splitSections(content);
    if (!sections.length) throw new BadRequestException("'## 제N조 (조항명)' 형식의 조항을 찾지 못했습니다");
    const title = b.title || content.match(/^#\s+(.+)$/m)?.[1]?.trim() || "문서";
    const prev = await this.prisma.document.findFirst({
      where: { shipperId, kind, isCurrent: true },
      include: { chunks: { orderBy: { order: "asc" } } },
    });
    let changeSummary: any = null;
    if (prev) {
      const d = this.ai.diff(prev.chunks.map((c) => ({ section: c.section, key: (c.section.match(/\(([^)]+)\)/)?.[1] ?? c.section).replace(/\s/g, ""), text: c.text })), sections);
      changeSummary = { fromVersion: prev.version, ...d, summary: await this.ai.summarizeDiff(d) };
    }
    const embeds = await this.ai.embed(sections.map((s) => `${title} ${s.section}\n${s.text}`));
    return this.prisma.$transaction(async (tx) => {
      await tx.document.updateMany({ where: { shipperId, kind, isCurrent: true }, data: { isCurrent: false } });
      const version = (prev?.version ?? (await tx.document.count({ where: { shipperId, kind } }))) + 1;
      return tx.document.create({
        data: {
          shipperId,
          kind,
          title,
          version,
          isCurrent: true,
          changeSummary,
          chunks: { create: sections.map((s, i) => ({ order: i, section: s.section, text: s.text, embedding: embeds[i] ?? [] })) },
        },
        select: { id: true, title: true, version: true, kind: true, changeSummary: true },
      });
    }, { timeout: 30000 });
  }

  /** 작업지시 카드의 화주사 주의사항: 현행 지침서의 입고·검수·수량·온도·파손 조항 원문 (AI 가공 없음) · 인터뷰(장 씨): 작업 순서·주의할 점이 헷갈림 */
  @Roles(...STAFF)
  @Get("shippers/:id/cautions")
  async cautions(@Param("id", ParseIntPipe) id: number) {
    const doc = await this.prisma.document.findFirst({
      where: { shipperId: id, kind: "GUIDE", isCurrent: true },
      include: { chunks: { orderBy: { order: "asc" } } },
    });
    if (!doc) return { title: null, version: null, items: [] };
    const items = doc.chunks.filter((c) => /(입고|검수|수량|온도|파손)/.test(c.section)).map((c) => ({ section: c.section, text: c.text }));
    return { title: doc.title, version: doc.version, items };
  }

  /** 최근 개정된 문서 (작업자 화면 알림용) — 인터뷰(관리자 김): 현장 관련 변경은 작업자도 알아야 함 */
  @Roles(...STAFF)
  @Get("documents-recent-changes")
  async recentChanges(@Req() req: any) {
    const docs = await this.prisma.document.findMany({
      where: { isCurrent: true, version: { gt: 1 }, createdAt: { gt: new Date(Date.now() - 14 * 86400e3) } },
      include: { shipper: true, acks: { where: { userId: req.user.id } } },
      orderBy: { createdAt: "desc" },
    });
    return docs.map((d) => ({ id: d.id, shipper: d.shipper.name, title: d.title, version: d.version, kind: d.kind, createdAt: d.createdAt, summary: (d.changeSummary as any)?.summary ?? null, ackedAt: d.acks[0]?.ackedAt ?? null }));
  }

  /** 개정 읽음 확인: 판당 1회 (2차 인터뷰 관리자 김 "너무 자주 누르면 번거롭다") */
  @Roles(...STAFF)
  @Post("documents/:id/ack")
  async ack(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    const d = await this.prisma.document.findUnique({ where: { id } });
    if (!d) throw new NotFoundException("문서가 없습니다");
    return this.prisma.docAck.upsert({
      where: { documentId_userId: { documentId: id, userId: req.user.id } },
      update: {},
      create: { documentId: id, userId: req.user.id },
    });
  }

  /** 판별 읽음 현황 (관리자) */
  @Roles(...OFFICE)
  @Get("documents/:id/acks")
  async acks(@Param("id", ParseIntPipe) id: number) {
    const [workers, acks] = await Promise.all([
      this.prisma.user.findMany({ where: { role: "WORKER" }, select: { id: true, name: true } }),
      this.prisma.docAck.findMany({ where: { documentId: id }, include: { user: { select: { name: true, role: true } } } }),
    ]);
    const map = new Map(acks.map((a) => [a.userId, a.ackedAt]));
    return { total: workers.length, read: workers.filter((w) => map.has(w.id)).length, workers: workers.map((w) => ({ name: w.name, ackedAt: map.get(w.id) ?? null })) };
  }

  // ───────── 근거 Q&A ─────────
  @Roles(...STAFF)
  @Post("ask")
  async ask(@Body() b: any) {
    const shipper = await this.prisma.shipper.findUnique({ where: { id: Number(b.shipperId) } });
    if (!shipper) throw new BadRequestException("화주사를 고르세요");
    if (!b.question?.trim()) throw new BadRequestException("질문을 입력하세요");
    const cites = await this.ai.search(shipper.id, b.question);
    const ans = await this.ai.answer(shipper.name, b.question, cites);
    return { ...ans, shipper: shipper.name, citations: ans.found ? cites : [], aiEnabled: this.ai.enabled };
  }
}
