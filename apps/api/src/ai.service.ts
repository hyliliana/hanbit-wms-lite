import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

export type Section = { section: string; key: string; text: string };
export type Citation = { documentId: number; title: string; kind: string; version: number; section: string; text: string; score: number };

/** "## 제N조 (조항명)" 단위로 문서를 자른다 */
export function splitSections(content: string): Section[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      if (cur) out.push(cur);
      const heading = m[1].trim();
      const name = heading.match(/\(([^)]+)\)/)?.[1] ?? heading;
      cur = { section: heading, key: name.replace(/\s/g, ""), text: "" };
    } else if (cur) {
      cur.text += line + "\n";
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
}

function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

function keywordScore(q: string, text: string) {
  const words = q.replace(/[?.,!]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  let s = 0;
  for (const w of words) {
    const stem = w.slice(0, Math.max(2, w.length - 1));
    if (text.includes(stem)) s += 1;
  }
  return words.length ? s / words.length : 0;
}

@Injectable()
export class AiService {
  private log = new Logger("AI");
  constructor(private prisma: PrismaService) {}

  get enabled() { return !!process.env.OPENAI_API_KEY; }
  private get model() { return process.env.OPENAI_MODEL || "gpt-4o-mini"; }

  private async openai(path: string, body: any) {
    const res = await fetch(`https://api.openai.com/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.enabled || !texts.length) return texts.map(() => []);
    try {
      const r = await this.openai("embeddings", { model: "text-embedding-3-small", input: texts });
      return r.data.map((d: any) => d.embedding);
    } catch (e) {
      this.log.warn(`임베딩 실패, 키워드 검색으로 대체: ${e}`);
      return texts.map(() => []);
    }
  }

  async chat(system: string, user: string): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const r = await this.openai("chat/completions", {
        model: this.model,
        temperature: 0,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      });
      return r.choices?.[0]?.message?.content ?? null;
    } catch (e) {
      this.log.warn(`답변 생성 실패: ${e}`);
      return null;
    }
  }

  /** 선택한 화주사의 '현행' 문서에서만 조항을 찾는다 */
  async search(shipperId: number, question: string, k = 4): Promise<Citation[]> {
    const chunks = await this.prisma.docChunk.findMany({
      where: { document: { shipperId, isCurrent: true } },
      include: { document: true },
    });
    if (!chunks.length) return [];
    const [qe] = await this.embed([question]);
    const scored = chunks.map((c) => {
      const kw = keywordScore(question, c.section + " " + c.text);
      const sem = qe.length && c.embedding.length ? cosine(qe, c.embedding) : 0;
      return {
        documentId: c.documentId,
        title: c.document.title,
        kind: c.document.kind,
        version: c.document.version,
        section: c.section,
        text: c.text,
        score: qe.length && c.embedding.length ? sem + kw * 0.15 : kw,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const min = qe.length ? 0.25 : 0.2;
    return scored.filter((s) => s.score >= min).slice(0, k);
  }

  /** 근거 조항만으로 답한다. 근거가 없으면 없다고 말한다 */
  async answer(shipperName: string, question: string, cites: Citation[]) {
    if (!cites.length) {
      return { answer: `${shipperName}의 현행 지침서·계약서에서 이 질문의 근거를 찾지 못했습니다. 관리자에게 확인하거나 화주사 담당 부서에 문의하세요.`, found: false };
    }
    const ctx = cites
      .map((c, i) => `[${i + 1}] ${c.title} (제${c.version}판) · ${c.section}\n${c.text}`)
      .join("\n\n");
    const sys =
      "너는 물류 창고 작업자와 관리자를 돕는 안내원이다. 반드시 주어진 근거 조항 안의 내용만으로 한국어로 짧고 분명하게 답한다. " +
      "해야 할 행동을 순서대로 1~3줄로 쓰고, 문장 끝에 근거 번호를 [1]처럼 붙인다. 근거에 없는 숫자·규칙은 절대 만들지 않는다. " +
      "근거로 답할 수 없으면 '자료에 근거가 없습니다'라고만 답한다. 취급 방법은 지침서, 책임·비용은 계약서를 우선한다.";
    const out = await this.chat(sys, `화주사: ${shipperName}\n질문: ${question}\n\n근거 조항:\n${ctx}`);
    if (out) return { answer: out.trim(), found: !out.includes("근거가 없습니다") };
    // AI를 못 쓸 때: 가장 관련 높은 조항 원문을 그대로 보여 준다
    return { answer: `(AI 연결 안 됨 · 관련 조항 원문)\n${cites[0].section}: ${cites[0].text}`, found: true };
  }

  /** 개정판 비교: 조항명 기준으로 추가·변경·삭제 */
  diff(oldS: Section[], newS: Section[]) {
    const oldMap = new Map(oldS.map((s) => [s.key, s]));
    const newMap = new Map(newS.map((s) => [s.key, s]));
    const added = newS.filter((s) => !oldMap.has(s.key)).map((s) => ({ section: s.section, after: s.text }));
    const removed = oldS.filter((s) => !newMap.has(s.key)).map((s) => ({ section: s.section, before: s.text }));
    const changed = newS
      .filter((s) => oldMap.has(s.key) && oldMap.get(s.key)!.text.replace(/\s/g, "") !== s.text.replace(/\s/g, ""))
      .map((s) => ({ section: s.section, before: oldMap.get(s.key)!.text, after: s.text }));
    return { added, changed, removed };
  }

  async summarizeDiff(d: ReturnType<AiService["diff"]>) {
    const parts = [
      ...d.changed.map((c) => `변경 ${c.section}\n전: ${c.before}\n후: ${c.after}`),
      ...d.added.map((c) => `추가 ${c.section}: ${c.after}`),
      ...d.removed.map((c) => `삭제 ${c.section}: ${c.before}`),
    ].join("\n\n");
    if (!parts) return "바뀐 조항이 없습니다.";
    const out = await this.chat(
      "물류 창고 관리자에게 지침서 개정 내용을 알려 준다. 현장 작업에 영향이 큰 것부터 3줄 이내 한국어 글머리표로, 숫자 변화(예: 24시간→6시간)는 그대로 밝힌다. 주어진 내용 밖의 것은 쓰지 않는다.",
      parts,
    );
    return out?.trim() ?? `변경 ${d.changed.length}개 · 추가 ${d.added.length}개 · 삭제 ${d.removed.length}개`;
  }
}
