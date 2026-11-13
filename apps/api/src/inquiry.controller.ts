import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseIntPipe, Post, Req } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { AiService } from "./ai.service";
import { AuthUser, Roles } from "./auth";

const STAFF = ["ADMIN", "MANAGER", "WORKER"] as const;
const OFFICE = ["ADMIN", "MANAGER"] as const;

/** 인터뷰 3차: 물건 안전·보관 조건·계약 관련이면 화주사 확인 필요 */
const NEEDS_SHIPPER = /(안전|위험|파손|깨|보관|온도|냉장|냉동|습도|유통기한|적재|쌓|단수|계약|책임|배상|비용|보관료|요금|반송|폐기)/;

/**
 * 지침서에 없는 질문의 위임 흐름 (인터뷰 3차)
 * 작업자 → 관리자 질문함 → (바로 답변 | 화주사 문의함 | 외부 확인 기록) → 관리자가 작업자에게 전달 → 센터 답변 저장
 * - 작업자는 화주사에 직접 연락할 수 없다
 * - 화주사는 관리자가 정리한 문의만 본다 (작업자 이름·원 질문 비공개)
 */
@Controller()
export class InquiryController {
  constructor(private prisma: PrismaService, private ai: AiService) {}

  // ───── 작업자(또는 직원): 관리자에게 확인 요청 ─────
  @Roles(...STAFF)
  @Post("inquiries")
  async create(@Req() req: any, @Body() b: any) {
    const shipper = await this.prisma.shipper.findUnique({ where: { id: Number(b.shipperId) } });
    if (!shipper) throw new BadRequestException("화주사를 고르세요");
    const q = String(b.question ?? "").trim();
    if (!q) throw new BadRequestException("질문을 입력하세요");
    return this.prisma.inquiry.create({ data: { shipperId: shipper.id, askerId: req.user.id, question: q, needsShipper: NEEDS_SHIPPER.test(q) } });
  }

  /** 작업자는 자기 질문만, 관리자·센터장은 전체 */
  @Roles(...STAFF)
  @Get("inquiries")
  async list(@Req() req: any) {
    const u: AuthUser = req.user;
    const rows = await this.prisma.inquiry.findMany({
      where: u.role === "WORKER" ? { askerId: u.id } : {},
      include: { shipper: true, asker: { select: { name: true } }, handler: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }],
    });
    if (u.role === "WORKER")
      // 작업자에게는 진행 상태와 최종 답만 (화주사와 주고받은 내용은 관리자 영역)
      return rows.map((r) => ({
        id: r.id, shipper: { name: r.shipper.name }, question: r.question, createdAt: r.createdAt,
        status: r.status === "DONE" ? "DONE" : "WAITING", finalAnswer: r.status === "DONE" ? r.finalAnswer : null,
        deliveredAt: r.deliveredAt, source: r.status === "DONE" ? r.source : null, confirmedDate: r.status === "DONE" ? r.confirmedDate : null,
      }));
    return rows;
  }

  private async mine(id: number) {
    const r = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!r) throw new NotFoundException("질문이 없습니다");
    return r;
  }

  /** '화주사 확인 필요' 표시 변경 */
  @Roles(...OFFICE)
  @Post("inquiries/:id/needs-shipper")
  async setNeeds(@Param("id", ParseIntPipe) id: number, @Body() b: any) {
    await this.mine(id);
    return this.prisma.inquiry.update({ where: { id }, data: { needsShipper: !!b?.value } });
  }

  /** [바로 답변] 관리자 판단으로 답하고 작업자에게 전달 */
  @Roles(...OFFICE)
  @Post("inquiries/:id/answer")
  async answer(@Req() req: any, @Param("id", ParseIntPipe) id: number, @Body() b: any) {
    const r = await this.mine(id);
    if (r.status !== "NEW") throw new BadRequestException(r.status === "DONE" ? "이미 답을 전달했습니다" : "화주사 문의가 진행 중입니다. 화주사 답을 받아 작업자에게 전달하세요");
    const a = String(b?.answer ?? "").trim();
    if (!a) throw new BadRequestException("답변을 입력하세요");
    return this.prisma.inquiry.update({ where: { id }, data: { status: "DONE", source: "MANAGER", finalAnswer: a, handlerId: req.user.id, deliveredAt: new Date() } });
  }

  /** [화주사에 문의] 관리자가 정리한 문의를 화주사 문의함으로 보냄 (작업자 원 질문은 보내지 않음) */
  @Roles(...OFFICE)
  @Post("inquiries/:id/ask-shipper")
  async askShipper(@Req() req: any, @Param("id", ParseIntPipe) id: number, @Body() b: any) {
    const r = await this.mine(id);
    if (r.status !== "NEW") throw new BadRequestException("이미 처리 중이거나 끝난 질문입니다");
    const m = String(b?.message ?? "").trim();
    if (!m) throw new BadRequestException("화주사에 보낼 문의 내용을 입력하세요");
    return this.prisma.inquiry.update({ where: { id }, data: { status: "ASKED_SHIPPER", shipperQuestion: m, shipperAskedAt: new Date(), handlerId: req.user.id } });
  }

  /** [외부 확인 기록] 전화·메일로 화주사에 확인한 결과 */
  @Roles(...OFFICE)
  @Post("inquiries/:id/external")
  async external(@Req() req: any, @Param("id", ParseIntPipe) id: number, @Body() b: any) {
    const r = await this.mine(id);
    if (r.status !== "NEW" && r.status !== "ASKED_SHIPPER") throw new BadRequestException("화주사 답이 이미 도착했거나 끝난 질문입니다");
    const content = String(b?.content ?? "").trim();
    const method = String(b?.method ?? "").trim();
    if (!content || !method) throw new BadRequestException("확인 방법과 내용을 입력하세요");
    const date = b?.date ? new Date(b.date) : new Date();
    if (isNaN(date.getTime())) throw new BadRequestException("확인 날짜가 올바르지 않습니다");
    const ok = await this.prisma.inquiry.updateMany({
      where: { id, status: { in: ["NEW", "ASKED_SHIPPER"] } },
      data: { status: "SHIPPER_REPLIED", source: "EXTERNAL", externalMethod: method, shipperAnswer: content, shipperAnsweredAt: date, confirmedDate: date, handlerId: req.user.id },
    });
    if (!ok.count) throw new BadRequestException("화주사 답이 이미 도착했거나 끝난 질문입니다");
    return this.mine(id);
  }

  /** [작업자에게 전달] 화주사 답(또는 관리자가 다듬은 답)을 작업자에게 */
  @Roles(...OFFICE)
  @Post("inquiries/:id/deliver")
  async deliver(@Req() req: any, @Param("id", ParseIntPipe) id: number, @Body() b: any) {
    const r = await this.mine(id);
    if (r.status !== "SHIPPER_REPLIED") throw new BadRequestException("화주사 답이 도착한 뒤에 전달할 수 있습니다");
    const a = (String(b?.answer ?? "").trim() || String(r.shipperAnswer ?? "").trim());
    if (!a) throw new BadRequestException("전달할 답을 입력하세요");
    return this.prisma.inquiry.update({ where: { id }, data: { status: "DONE", finalAnswer: a, deliveredAt: new Date(), handlerId: req.user.id } });
  }

  /** [센터 답변으로 저장] 같은 화주사·같은 상황이면 다음부터 바로 보여 줌 */
  @Roles(...OFFICE)
  @Post("inquiries/:id/save")
  async save(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    const r = await this.mine(id);
    if (r.status !== "DONE" || !r.finalAnswer) throw new BadRequestException("작업자에게 답을 전달한 뒤에 저장할 수 있습니다");
    if (r.savedAnswerId) throw new BadRequestException("이미 센터 답변으로 저장했습니다");
    const [emb] = await this.ai.embed([r.question]);
    const shipperConfirmed = r.source === "SHIPPER_APP" || r.source === "EXTERNAL";
    const ca = await this.prisma.centerAnswer.create({
      data: {
        shipperId: r.shipperId, question: r.question, answer: r.finalAnswer, shipperConfirmed,
        confirmedDate: shipperConfirmed ? r.confirmedDate : r.deliveredAt, savedById: req.user.id, embedding: emb ?? [],
      },
    });
    await this.prisma.inquiry.update({ where: { id }, data: { savedAnswerId: ca.id } });
    return ca;
  }

  /** 센터 답변 목록 (관리자) */
  @Roles(...OFFICE)
  @Get("center-answers")
  async centerAnswers() {
    return this.prisma.centerAnswer.findMany({ include: { shipper: true, savedBy: { select: { name: true } } }, orderBy: { savedAt: "desc" } });
  }

  /** 센터 답변 재확인 완료 */
  @Roles(...OFFICE)
  @Post("center-answers/:id/rechecked")
  async rechecked(@Param("id", ParseIntPipe) id: number) {
    const c = await this.prisma.centerAnswer.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    return this.prisma.centerAnswer.update({ where: { id }, data: { needsRecheck: false, recheckReason: null, confirmedDate: new Date() } });
  }

  // ───── 화주사: 센터 문의함 (자기 회사 문의만, 관리자가 보낸 내용만) ─────
  @Roles("SHIPPER")
  @Get("shipper-inquiries")
  async shipperList(@Req() req: any) {
    const rows = await this.prisma.inquiry.findMany({
      where: { shipperId: req.user.shipperId, shipperQuestion: { not: null }, OR: [{ source: null }, { source: { not: "EXTERNAL" } }] },
      orderBy: { shipperAskedAt: "desc" },
    });
    return rows.map((r) => ({ id: r.id, message: r.shipperQuestion, askedAt: r.shipperAskedAt, answer: r.shipperAnswer, answeredAt: r.shipperAnsweredAt }));
  }

  @Roles("SHIPPER")
  @Post("shipper-inquiries/:id/reply")
  async shipperReply(@Req() req: any, @Param("id", ParseIntPipe) id: number, @Body() b: any) {
    const r = await this.mine(id);
    if (r.shipperId !== req.user.shipperId || !r.shipperQuestion) throw new ForbiddenException("이 문의에 답할 권한이 없습니다");
    if (r.status !== "ASKED_SHIPPER") throw new BadRequestException(r.source === "EXTERNAL" ? "센터가 다른 방법으로 이미 확인한 문의입니다" : "이미 답한 문의입니다");
    const a = String(b?.answer ?? "").trim();
    if (!a) throw new BadRequestException("답을 입력하세요");
    const now = new Date();
    const ok = await this.prisma.inquiry.updateMany({ where: { id, status: "ASKED_SHIPPER" }, data: { status: "SHIPPER_REPLIED", source: "SHIPPER_APP", shipperAnswer: a, shipperAnsweredAt: now, confirmedDate: now } });
    if (!ok.count) throw new BadRequestException("이미 답한 문의입니다");
    return { id, answer: a, answeredAt: now };
  }
}
