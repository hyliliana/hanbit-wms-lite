"use client";

import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ZONE: Record<string, string> = { AMBIENT: "상온", CHILLED: "냉장", FROZEN: "냉동" };
const ROLE: Record<string, string> = { ADMIN: "센터장", MANAGER: "관리자", WORKER: "작업자", SHIPPER: "화주사" };

type User = { id: number; name: string; role: string; shipperId: number | null; shipperName?: string | null };

function useApi(token: string | null, onExpired: () => void) {
  return useCallback(
    async (path: string, opts: { method?: string; body?: any } = {}) => {
      const res = await fetch(`${API_URL}${path}`, {
        method: opts.method ?? "GET",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && token) onExpired();
      if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || `오류 ${res.status}`);
      return data;
    },
    [token, onExpired],
  );
}
type Api = ReturnType<typeof useApi>;

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : "-");
const minsSince = (a: string, b?: string | null) => Math.max(0, Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 60000));
const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const t = localStorage.getItem("wms_token");
      const u = localStorage.getItem("wms_user");
      if (t && u) { setToken(t); setUser(JSON.parse(u)); }
    } catch {}
    setReady(true);
  }, []);

  const logout = useCallback(() => {
    try { localStorage.removeItem("wms_token"); localStorage.removeItem("wms_user"); } catch {}
    setToken(null); setUser(null);
  }, []);
  const api = useApi(token, logout);

  if (!ready) return null;
  if (!token || !user)
    return <Login api={api} onLogin={(t, u) => { try { localStorage.setItem("wms_token", t); localStorage.setItem("wms_user", JSON.stringify(u)); } catch {} setToken(t); setUser(u); }} />;

  return (
    <>
      <div className="top">
        <b>한빛 WMS Lite</b>
        <span className="who">{user.name} · {ROLE[user.role]}{user.shipperName ? ` (${user.shipperName})` : ""}</span>
        <button onClick={logout}>로그아웃</button>
      </div>
      {user.role === "WORKER" && <Worker api={api} user={user} />}
      {(user.role === "MANAGER" || user.role === "ADMIN") && <Manager api={api} user={user} />}
      {user.role === "SHIPPER" && <ShipperView api={api} user={user} />}
    </>
  );
}

// ───────── 로그인 ─────────
function Login({ api, onLogin }: { api: Api; onLogin: (t: string, u: User) => void }) {
  const [loginId, setId] = useState("");
  const [password, setPw] = useState("");
  const [err, setErr] = useState("");
  const [accs, setAccs] = useState<any[]>([]);
  useEffect(() => { api("/auth/demo-accounts").then(setAccs).catch(() => setErr("처리 서버에 연결할 수 없습니다")); }, [api]);
  const submit = async () => {
    setErr("");
    try { const r = await api("/auth/login", { method: "POST", body: { loginId, password } }); onLogin(r.token, r.user); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="wrap login">
      <h1 style={{ marginBottom: 4 }}>한빛 WMS Lite</h1>
      <p className="muted">한빛물류 이천센터 · 화주사마다 다른 규칙을 현장에서 바로 찾고 지킵니다</p>
      <div className="card">
        <label>아이디</label>
        <input value={loginId} onChange={(e) => setId(e.target.value)} />
        <label>비밀번호</label>
        <input type="password" value={password} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {err && <div className="err">{err}</div>}
        <div style={{ marginTop: 12 }}><button className="btn big" onClick={submit}>로그인</button></div>
      </div>
      {accs.length > 0 && (
        <div className="card">
          <h3>시연용 계정 (비밀번호 demo1234)</h3>
          {accs.map((a) => (
            <button key={a.loginId} className="acc" onClick={() => setId(a.loginId)}>
              <span>{a.name}</span><span className="muted">{ROLE[a.role]} · {a.loginId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── 공통: 화주사 규칙 질문 ─────────
function AskBox({ api, shippers, onAsked }: { api: Api; shippers: any[]; onAsked?: () => void }) {
  const [sid, setSid] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const ask = async () => {
    setBusy(true); setErr(""); setRes(null); setSent(false);
    try { setRes(await api("/ask", { method: "POST", body: { shipperId: Number(sid), question: q } })); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="card">
      <h2>화주사 규칙 질문</h2>
      <p className="muted">고른 화주사의 <b>현행</b> 지침서·계약서에서만 찾아 답하고, 근거 조항을 함께 보여 줍니다.</p>
      <label>화주사</label>
      <select value={sid} onChange={(e) => setSid(e.target.value)}>
        <option value="">화주사를 고르세요</option>
        {shippers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
      </select>
      <label>자주 찾는 질문</label>
      <div className="row">
        {["파손된 박스가 입고되면 어떻게 처리하나요?", "보관 온도 범위가 어떻게 되나요?", "출고할 때 어떤 순서로 내보내나요?"].map((t) => (
          <button key={t} className="btn ghost" style={{ padding: "6px 10px", fontSize: 13 }} onClick={() => setQ(t)}>{t.replace(/[?]/, "")}</button>
        ))}
      </div>
      <label>질문</label>
      <textarea value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 박스가 젖은 채로 입고됐어요. 어떻게 해야 하나요?" />
      <div style={{ marginTop: 8 }}><button className="btn" disabled={!sid || !q.trim() || busy} onClick={ask}>{busy ? "찾는 중..." : "질문하기"}</button></div>
      {err && <div className="err">{err}</div>}
      {res && (
        <div style={{ marginTop: 12 }}>
          <div className="answer">{res.answer}</div>
          {res.citations?.map((c: any, i: number) => (
            <div className="cite" key={i}>
              <b>[{i + 1}] {c.title} · 제{c.version}판 · {c.section}</b>
              <div className="muted">{c.text}</div>
            </div>
          ))}
          <CenterAnswers list={res.centerAnswers} />
          {!res.found && (
            <>
              {res.nearby?.length > 0 && <p className="muted" style={{ marginTop: 10 }}>참고용 · 가장 가까운 조항 (이 질문의 답은 아닙니다)</p>}
              {res.nearby?.map((c: any, i: number) => (
                <div className="cite" key={i}><b>{c.title} · 제{c.version}판 · {c.section}</b><div className="muted">{c.text}</div></div>
              ))}
              {sent ? (
                <div className="okmsg">관리자에게 확인 요청을 보냈습니다. 답이 오면 &lsquo;내 질문&rsquo;에서 볼 수 있습니다.</div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <button className="btn big" onClick={async () => {
                    try { await api("/inquiries", { method: "POST", body: { shipperId: res.shipperId, question: q } }); setSent(true); onAsked?.(); }
                    catch (e: any) { setErr(e.message); }
                  }}>관리자에게 확인 요청</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 저장된 센터 답변 (지침서 근거와 구분해 표시) */
function CenterAnswers({ list }: { list?: any[] }) {
  if (!list?.length) return null;
  return (
    <>
      {list.map((c) => (
        <div className="ca" key={c.id}>
          <div className="row">
            <span className="chip">센터 답변</span>
            {c.shipperConfirmed ? <span className="chip ok">화주사 확인 {fmtDate(c.confirmedDate)}</span> : <span className="chip">관리자 판단</span>}
            {c.daysAgo !== null && <span className="muted">{c.daysAgo === 0 ? "오늘 확인" : `${c.daysAgo}일 전 확인`}</span>}
            {c.needsRecheck && <span className="chip warn">{c.recheckReason ?? "지침 개정 후 재확인 필요"}</span>}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>같은 질문: {c.question}</div>
          <div style={{ marginTop: 4 }}>{c.answer}</div>
        </div>
      ))}
    </>
  );
}

/** 작업자: 내 질문 (대기 / 답변 완료) */
function MyInquiries({ api }: { api: Api }) {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { const load = () => api("/inquiries").then(setList).catch(() => {}); load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [api]);
  return (
    <>
      {list.length === 0 && <div className="card muted">관리자에게 확인 요청한 질문이 없습니다.</div>}
      {list.map((q) => (
        <div className="q" key={q.id}>
          <div className="row">
            {q.status === "DONE" ? <span className="chip ok">답변 완료</span> : <span className="chip warn">관리자 확인 중</span>}
            <b>{q.shipper.name}</b><span className="muted">{fmtTime(q.createdAt)}</span>
          </div>
          <p style={{ margin: "6px 0" }}>{q.question}</p>
          {q.status === "DONE" && (
            <div className="answer">
              {q.finalAnswer}
              <div className="muted" style={{ marginTop: 4 }}>{q.source === "MANAGER" ? "관리자 답변" : `화주사 확인 ${fmtDate(q.confirmedDate)}`} · {fmtTime(q.deliveredAt)}</div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function Citations({ list }: { list: any[] }) {
  if (!list?.length) return null;
  return (
    <>
      {list.map((c, i) => (
        <div className="cite" key={i}><b>[{i + 1}] {c.title} · 제{c.version}판 · {c.section}</b><div className="muted">{c.text}</div></div>
      ))}
    </>
  );
}

// ───────── 작업자 (휴대폰) ─────────
function Worker({ api, user }: { api: Api; user: User }) {
  const [tab, setTab] = useState<"tasks" | "damage" | "ask" | "mine">("tasks");
  const [orders, setOrders] = useState<any[]>([]);
  const [shippers, setShippers] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [qty, setQty] = useState<Record<number, string>>({});
  const [damageFor, setDamageFor] = useState<any>(null);
  const [changes, setChanges] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      api("/documents-recent-changes").then(setChanges).catch(() => {});
      setOrders(await api("/work-orders"));
      setShippers(await api("/shippers"));
    } catch (e: any) { setErr(e.message); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const complete = async (w: any) => {
    setErr(""); setMsg("");
    try {
      const r = await api(`/work-orders/${w.id}/complete`, { method: "POST", body: { actualQty: qty[w.id] === undefined || qty[w.id] === "" ? undefined : Number(qty[w.id]) } });
      setMsg(r.diff === 0 ? `${w.item.name} 입고 완료 (수량 일치)` : `${w.item.name} 입고 완료 · 예정과 ${r.diff > 0 ? "+" : ""}${r.diff}개 차이 → 관리자에게 표시됩니다`);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const planned = orders.filter((o) => o.status === "PLANNED");
  const done = orders.filter((o) => o.status === "DONE");

  return (
    <div className="wrap narrow">
      <div className="tabs">
        <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>내 작업 {planned.length}</button>
        <button className={tab === "damage" ? "on" : ""} onClick={() => { setDamageFor(null); setTab("damage"); }}>파손 보고</button>
        <button className={tab === "ask" ? "on" : ""} onClick={() => setTab("ask")}>규칙 질문</button>
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>내 질문</button>
      </div>
      {msg && <div className="okmsg">{msg}</div>}
      {err && <div className="err">{err}</div>}

      {tab === "tasks" && (
        <>
          {changes.map((c) => (
            <div className="card" key={c.id} style={{ borderColor: "var(--warn)", background: "var(--warn-bg)" }}>
              <b>📢 {c.shipper} {c.kind === "GUIDE" ? "지침서" : "계약서"} 제{c.version}판으로 바뀌었습니다</b>
              {c.summary && <div style={{ whiteSpace: "pre-wrap", marginTop: 6, fontSize: 14 }}>{c.summary}</div>}
              <div style={{ marginTop: 8 }}>
                {c.ackedAt ? <span className="chip ok">읽음 확인 {fmtTime(c.ackedAt)}</span> : <button className="btn" onClick={async () => { await api(`/documents/${c.id}/ack`, { method: "POST" }); load(); }}>읽었습니다</button>}
              </div>
            </div>
          ))}
          {planned.length === 0 && <div className="card muted">남은 입고 작업이 없습니다.</div>}
          {planned.map((w) => (
            <div className="task" key={w.id}>
              <div className="row"><span className={`chip ${w.item.zone}`}>{ZONE[w.item.zone]}</span><b>{w.shipper.name}</b><span className="muted">로트 {w.lotNo}</span></div>
              <h3 style={{ margin: "6px 0" }}>{w.item.name}</h3>
              <div className="muted">보관 위치 <b>{w.location}</b> · 예정 <b>{w.expectedQty}</b>개 · 유통기한 {fmtDate(w.expiryDate)}</div>
              <Cautions api={api} shipperId={w.shipperId} shipperName={w.shipper.name} />
              <label>실제 받은 수량</label>
              <input inputMode="numeric" value={qty[w.id] ?? ""} onChange={(e) => setQty({ ...qty, [w.id]: e.target.value.replace(/[^0-9]/g, "") })} placeholder="세어 본 수량" />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={() => complete(w)}>입고 완료</button>
                <button className="btn danger" onClick={() => { setDamageFor(w); setTab("damage"); }}>파손 있음</button>
              </div>
            </div>
          ))}
          {done.length > 0 && <h3 className="muted">완료한 작업</h3>}
          {done.slice(0, 5).map((w) => (
            <div className="task done" key={w.id}>
              <b>{w.item.name}</b> · {w.shipper.name}
              <div className="muted">예정 {w.expectedQty} / 실제 {w.actualQty} {w.diff !== 0 && <span className="chip bad">차이 {w.diff > 0 ? "+" : ""}{w.diff}</span>}</div>
            </div>
          ))}
        </>
      )}
      {tab === "damage" && <DamageForm api={api} shippers={shippers} preset={damageFor} onDone={(m) => { setMsg(m); setTab("tasks"); load(); }} />}
      {tab === "ask" && <AskBox api={api} shippers={shippers} />}
      {tab === "mine" && <MyInquiries api={api} />}
    </div>
  );
}

/** 작업지시 카드에 붙는 화주사 주의사항 (현행 지침서 원문, 펼쳐 보기) */
function Cautions({ api, shipperId, shipperName }: { api: Api; shipperId: number; shipperName: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const toggle = async () => {
    if (!open && !data) { try { setData(await api(`/shippers/${shipperId}/cautions`)); } catch { setData({ items: [] }); } }
    setOpen(!open);
  };
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn ghost" onClick={toggle}>{open ? "주의사항 닫기" : `${shipperName} 입고 주의사항 보기`}</button>
      {open && data && (
        <div style={{ marginTop: 6 }}>
          {data.items.length === 0 && <p className="muted">등록된 지침서가 없습니다. 관리자에게 확인하세요.</p>}
          {data.title && <p className="muted">{data.title} · 제{data.version}판 (현행)</p>}
          {data.items.map((c: any, i: number) => <div className="cite" key={i}><b>{c.section}</b><div>{c.text}</div></div>)}
        </div>
      )}
    </div>
  );
}

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
  const max = 900;
  const r = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL("image/jpeg", 0.7);
}

function DamageForm({ api, shippers, preset, onDone }: { api: Api; shippers: any[]; preset: any; onDone: (m: string) => void }) {
  const [sid, setSid] = useState(preset ? String(preset.shipperId) : "");
  const [items, setItems] = useState<any[]>([]);
  const [itemId, setItemId] = useState(preset ? String(preset.itemId) : "");
  const [qty, setQty] = useState("1");
  const [desc, setDesc] = useState("");
  const [labelNo, setLabelNo] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);

  useEffect(() => { if (sid) api(`/items?shipperId=${sid}`).then(setItems).catch(() => {}); else setItems([]); }, [sid, api]);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api("/damages", { method: "POST", body: { shipperId: Number(sid), itemId: itemId ? Number(itemId) : undefined, workOrderId: preset?.id, qty: Number(qty), labelNo, description: desc, photo } });
      setResult(r);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  if (result)
    return (
      <div className="card">
        <div className="okmsg">파손 보고를 보냈습니다. 관리자 화면에 바로 표시됩니다.</div>
        <h3>이 화주사의 파손 처리 방법</h3>
        <div className="answer">{result.aiGuidance}</div>
        <Citations list={result.aiCitations} />
        <NotifyDue d={result} />
        <p className="muted">최종 처리는 관리자가 확인한 뒤 정합니다.</p>
        <button className="btn big" onClick={() => onDone("파손 보고 완료 · 관리자 확인을 기다립니다")}>확인</button>
      </div>
    );

  return (
    <div className="card">
      <h2>파손 보고</h2>
      {preset && (
        <div className="diffbox chg">
          <b>이 입고 건에 자동 연결</b>
          <div>{preset.item.name} · 로트 {preset.lotNo} · 위치 {preset.location} · 예정 {preset.expectedQty}개</div>
        </div>
      )}
      <label>화주사</label>
      <select value={sid} onChange={(e) => { setSid(e.target.value); setItemId(""); }}>
        <option value="">화주사를 고르세요</option>
        {shippers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label>입고 물건 (필수)</label>
      <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
        <option value="">품목을 고르세요</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <label>박스 라벨/송장 번호 (선택)</label>
      <input value={labelNo} onChange={(e) => setLabelNo(e.target.value)} placeholder="예: 송장 1234-5678 또는 박스 라벨 번호" />
      <label>파손 수량 (박스)</label>
      <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} />
      <label>어떤 파손인가요</label>
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="예: 박스 한쪽이 젖어 있고 바닥이 눌렸음" />
      <label>사진 (필수)</label>
      <input type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await shrink(f)); }} />
      {photo && <img src={photo} className="photo" alt="파손 사진" style={{ marginTop: 8 }} />}
      <p className="muted">발견 시각은 보고하는 순간 자동으로 기록됩니다. {!photo ? "· 사진을 붙여야 보낼 수 있습니다" : ""}</p>
      {err && <div className="err">{err}</div>}
      <div style={{ marginTop: 12 }}><button className="btn big danger" disabled={!sid || !desc.trim() || !photo || (!itemId && !preset) || busy} onClick={submit}>{busy ? "보내는 중... (지침 찾는 중)" : "관리자에게 바로 보고"}</button></div>
    </div>
  );
}

// ───────── 관리자 ─────────
function Manager({ api, user }: { api: Api; user: User }) {
  const [tab, setTab] = useState<"home" | "inbound" | "damage" | "docs" | "ask" | "stock" | "inq">("home");
  const [dash, setDash] = useState<any>(null);
  const [shippers, setShippers] = useState<any[]>([]);
  const refresh = useCallback(() => { api("/dashboard").then(setDash).catch(() => {}); }, [api]);
  useEffect(() => { refresh(); api("/shippers").then(setShippers).catch(() => {}); const t = setInterval(refresh, 10000); return () => clearInterval(t); }, [api, refresh]);

  return (
    <div className="wrap">
      <div className="tabs">
        <button className={tab === "home" ? "on" : ""} onClick={() => setTab("home")}>요약</button>
        <button className={tab === "damage" ? "on" : ""} onClick={() => setTab("damage")}>파손함{dash?.unconfirmedDamages ? <span className="badge">{dash.unconfirmedDamages}</span> : null}</button>
        <button className={tab === "inbound" ? "on" : ""} onClick={() => setTab("inbound")}>입고·수량 차이{dash?.qtyMismatches ? <span className="badge">{dash.qtyMismatches}</span> : null}</button>
        <button className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>재고</button>
        <button className={tab === "docs" ? "on" : ""} onClick={() => setTab("docs")}>지침서·계약서</button>
        <button className={tab === "inq" ? "on" : ""} onClick={() => setTab("inq")}>질문함{dash?.openInquiries ? <span className="badge">{dash.openInquiries}</span> : null}</button>
        <button className={tab === "ask" ? "on" : ""} onClick={() => setTab("ask")}>규칙 질문</button>
      </div>
      {dash?.overdueDamages > 0 && (
        <div className="err" style={{ fontSize: 15, cursor: "pointer" }} onClick={() => setTab("damage")}>
          🔔 {user.role === "ADMIN" ? "센터장 알림: " : ""}{dash.damageSlaMinutes}분 넘게 확인 안 된 파손 {dash.overdueDamages}건{user.role === "ADMIN" ? " — 관리자 확인이 늦어지고 있습니다" : " — 센터장 화면에도 알림이 표시됩니다"}
        </div>
      )}
      {tab === "home" && !dash && <div className="card muted">현황을 불러오는 중...</div>}
      {tab === "home" && dash && (
        <div className="grid">
          <div className="card" onClick={() => setTab("damage")} style={{ cursor: "pointer", borderColor: dash.overdueDamages ? "var(--bad)" : undefined }}><div className="muted">{dash.damageSlaMinutes}분 넘게 확인 안 된 파손</div><div className="stat" style={{ color: dash.overdueDamages ? "var(--bad)" : "var(--ok)" }}>{dash.overdueDamages}</div><div className="muted">현장 기준: 관리자가 {dash.damageSlaMinutes}분 안에 확인</div></div>
          <div className="card" onClick={() => setTab("damage")} style={{ cursor: "pointer", borderColor: dash.notifyOverdue ? "var(--bad)" : undefined }}><div className="muted">화주사 통보 기한 지난 파손</div><div className="stat" style={{ color: dash.notifyOverdue ? "var(--bad)" : "var(--ok)" }}>{dash.notifyOverdue}</div><div className="muted">기한은 각 화주사 지침서 · 늦으면 계약서상 센터 부담</div></div>
          <div className="card" onClick={() => setTab("damage")} style={{ cursor: "pointer" }}><div className="muted">미확인 파손 보고</div><div className="stat" style={{ color: dash.unconfirmedDamages ? "var(--bad)" : undefined }}>{dash.unconfirmedDamages}</div></div>
          <div className="card" onClick={() => setTab("inbound")} style={{ cursor: "pointer" }}><div className="muted">수량 차이 입고</div><div className="stat" style={{ color: dash.qtyMismatches ? "var(--bad)" : undefined }}>{dash.qtyMismatches}</div></div>
          <div className="card" onClick={() => setTab("inbound")} style={{ cursor: "pointer" }}><div className="muted">대기 중 입고 작업</div><div className="stat">{dash.plannedOrders}</div></div>
        </div>
      )}
      {tab === "damage" && <DamageInbox api={api} onChange={refresh} />}
      {tab === "inbound" && <Inbound api={api} shippers={shippers} onChange={refresh} />}
      {tab === "stock" && <Stock api={api} shippers={shippers} />}
      {tab === "docs" && <Docs api={api} shippers={shippers} />}
      {tab === "ask" && <AskBox api={api} shippers={shippers} onAsked={refresh} />}
      {tab === "inq" && <InquiryInbox api={api} onChange={refresh} />}
    </div>
  );
}

const INQ_STATUS: Record<string, [string, string]> = {
  NEW: ["새 질문", "bad"],
  ASKED_SHIPPER: ["화주사 답 대기", "warn"],
  SHIPPER_REPLIED: ["화주사 답 도착", "warn"],
  DONE: ["전달 완료", "ok"],
};

/** 관리자 질문함: 작업자 → 관리자 → (화주사) → 관리자 → 작업자 */
function InquiryInbox({ api, onChange }: { api: Api; onChange: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [cas, setCas] = useState<any[]>([]);
  const [mode, setMode] = useState<Record<number, string>>({});
  const [txt, setTxt] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    api("/inquiries").then(setList).catch((e) => setErr(e.message));
    api("/center-answers").then(setCas).catch(() => {});
  }, [api]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  const act = async (path: string, body?: any) => {
    setErr("");
    try { await api(path, { method: "POST", body }); load(); onChange(); }
    catch (e: any) { setErr(e.message); }
  };
  const t = (k: string, d = "") => txt[k] ?? d;
  const setT = (k: string, v: string) => setTxt({ ...txt, [k]: v });
  return (
    <>
      {err && <div className="err">{err}</div>}
      {list.length === 0 && <div className="card muted">작업자가 보낸 확인 요청이 없습니다.</div>}
      {list.map((q) => (
        <div className="card" key={q.id} style={q.status === "NEW" ? { borderColor: "var(--bad)" } : undefined}>
          <div className="row">
            <span className={`chip ${INQ_STATUS[q.status][1]}`}>{INQ_STATUS[q.status][0]}</span>
            <b>{q.shipper.name}</b>
            <span className="muted">{q.asker.name} · {fmtTime(q.createdAt)}</span>
            <label className="row" style={{ margin: 0, color: "var(--ink)" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={q.needsShipper} disabled={q.status === "DONE"} onChange={(e) => act(`/inquiries/${q.id}/needs-shipper`, { value: e.target.checked })} />
              <span className={`chip ${q.needsShipper ? "warn" : ""}`}>화주사 확인 필요</span>
            </label>
          </div>
          <p style={{ margin: "8px 0", fontSize: 16 }}>{q.question}</p>

          {(q.status === "NEW" || q.status === "ASKED_SHIPPER") && (
            <>
              {q.status === "ASKED_SHIPPER" && (
                <div className="diffbox chg"><b>화주사에 보낸 문의</b> · {fmtTime(q.shipperAskedAt)}<div>{q.shipperQuestion}</div><div className="muted">화주사 담당자가 앱 문의함에서 답하면 여기에 도착합니다.</div></div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                {q.status === "NEW" && <button className={`btn ${mode[q.id] === "answer" ? "" : "ghost"}`} onClick={() => setMode({ ...mode, [q.id]: "answer" })}>바로 답변</button>}
                {q.status === "NEW" && <button className={`btn ${mode[q.id] === "shipper" ? "" : "ghost"}`} onClick={() => setMode({ ...mode, [q.id]: "shipper" })}>화주사에 문의</button>}
                <button className={`btn ${mode[q.id] === "external" ? "" : "ghost"}`} onClick={() => setMode({ ...mode, [q.id]: "external" })}>외부 확인 기록</button>
              </div>
              {mode[q.id] === "answer" && (
                <div style={{ marginTop: 8 }}>
                  {q.needsShipper && <div className="diffbox chg">안전·보관 조건·계약과 관련된 질문입니다. 화주사 확인을 먼저 권합니다.</div>}
                  <textarea value={t(`a${q.id}`)} onChange={(e) => setT(`a${q.id}`, e.target.value)} placeholder="작업자에게 보낼 답 (관리자 판단)" />
                  <button className="btn" onClick={() => act(`/inquiries/${q.id}/answer`, { answer: t(`a${q.id}`) })}>바로 답변</button>
                </div>
              )}
              {mode[q.id] === "shipper" && (
                <div style={{ marginTop: 8 }}>
                  <p className="muted">화주사에는 아래 문의 내용만 보입니다(작업자 이름은 보내지 않음).</p>
                  <textarea value={t(`s${q.id}`, q.question)} onChange={(e) => setT(`s${q.id}`, e.target.value)} />
                  <button className="btn" onClick={() => act(`/inquiries/${q.id}/ask-shipper`, { message: t(`s${q.id}`, q.question) })}>화주사에 문의</button>
                </div>
              )}
              {mode[q.id] === "external" && (
                <div style={{ marginTop: 8 }}>
                  <div className="grid">
                    <div><label>확인 방법</label><select value={t(`m${q.id}`, "전화")} onChange={(e) => setT(`m${q.id}`, e.target.value)}><option>전화</option><option>메일</option><option>메신저</option><option>방문</option></select></div>
                    <div><label>확인 날짜</label><input type="date" value={t(`d${q.id}`, new Date().toISOString().slice(0, 10))} onChange={(e) => setT(`d${q.id}`, e.target.value)} /></div>
                  </div>
                  <label>화주사가 알려 준 내용</label>
                  <textarea value={t(`e${q.id}`)} onChange={(e) => setT(`e${q.id}`, e.target.value)} />
                  <button className="btn" onClick={() => act(`/inquiries/${q.id}/external`, { method: t(`m${q.id}`, "전화"), date: t(`d${q.id}`, new Date().toISOString().slice(0, 10)), content: t(`e${q.id}`) })}>외부 확인 기록</button>
                </div>
              )}
            </>
          )}

          {q.status === "SHIPPER_REPLIED" && (
            <div style={{ marginTop: 8 }}>
              <div className="diffbox add"><b>화주사 답</b> · {q.source === "EXTERNAL" ? `${q.externalMethod}로 확인` : "앱 문의함"} · {fmtDate(q.confirmedDate)}<div>{q.shipperAnswer}</div></div>
              <label>작업자에게 보낼 답 (다듬어도 됩니다)</label>
              <textarea value={t(`f${q.id}`, q.shipperAnswer ?? "")} onChange={(e) => setT(`f${q.id}`, e.target.value)} />
              <button className="btn" onClick={() => act(`/inquiries/${q.id}/deliver`, { answer: t(`f${q.id}`, q.shipperAnswer ?? "") })}>작업자에게 전달</button>
            </div>
          )}

          {q.status === "DONE" && (
            <div style={{ marginTop: 8 }}>
              <div className="answer">{q.finalAnswer}<div className="muted" style={{ marginTop: 4 }}>{q.source === "MANAGER" ? "관리자 판단" : `화주사 확인 ${fmtDate(q.confirmedDate)}`} · 작업자에게 전달 {fmtTime(q.deliveredAt)}</div></div>
              <div style={{ marginTop: 8 }}>
                {q.savedAnswerId ? <span className="chip ok">센터 답변으로 저장됨</span> : <button className="btn ghost" onClick={() => act(`/inquiries/${q.id}/save`)}>센터 답변으로 저장</button>}
              </div>
            </div>
          )}
        </div>
      ))}
      {cas.length > 0 && (
        <div className="card">
          <h2>저장된 센터 답변</h2>
          <p className="muted">같은 화주사에서 같은 질문이 오면 규칙 질문에 &lsquo;센터 답변&rsquo;으로 바로 나옵니다.</p>
          {cas.map((c) => (
            <div className="ca" key={c.id}>
              <div className="row">
                <b>{c.shipper.name}</b>
                {c.shipperConfirmed ? <span className="chip ok">화주사 확인 {fmtDate(c.confirmedDate)}</span> : <span className="chip">관리자 판단</span>}
                {c.needsRecheck && <><span className="chip warn">{c.recheckReason}</span><button className="btn ghost" onClick={() => act(`/center-answers/${c.id}/rechecked`)}>재확인 완료</button></>}
              </div>
              <div className="muted">질문: {c.question}</div>
              <div>{c.answer}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NotifyDue({ d }: { d: any }) {
  if (!d.notifyDueAt) return <div className="diffbox chg"><b>화주사 통보 기한 없음 · 관리자 판단</b> (현행 지침서에 기한이 없고, 센터 기본값도 없음)</div>;
  const left = Math.round((new Date(d.notifyDueAt).getTime() - Date.now()) / 60000);
  const late = !d.notifiedAt && left < 0;
  const leftText = left >= 60 ? `${Math.floor(left / 60)}시간 ${left % 60}분 남음` : left >= 0 ? `${left}분 남음` : `${Math.abs(left)}분 지남`;
  return (
    <div className={`diffbox ${d.notifiedAt ? "add" : late ? "del" : "chg"}`}>
      <b>화주사 통보 마감 {fmtTime(d.notifyDueAt)}</b> ({d.notifyHours ? `${d.notifyHours}시간 안` : "발견 당일 안"}) ·{" "}
      {d.notifiedAt ? `통보 완료 ${fmtTime(d.notifiedAt)}` : late ? <b style={{ color: "var(--bad)" }}>{leftText} · 계약서상 늦은 통보로 늘어난 손해는 센터 부담</b> : leftText}
      {d.notifySource && <div className="muted">근거: {d.notifySource}</div>}
    </div>
  );
}

function DamageInbox({ api, onChange }: { api: Api; onChange: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [note, setNote] = useState<Record<number, string>>({});
  const [notified, setNotified] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState("");
  const load = useCallback(() => api("/damages").then(setList).catch((e) => setErr(e.message)), [api]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  const confirm = async (d: any) => {
    try { await api(`/damages/${d.id}/confirm`, { method: "POST", body: { managerNote: note[d.id], notified: !!notified[d.id] } }); load(); onChange(); }
    catch (e: any) { setErr(e.message); }
  };
  const markNotified = async (d: any) => {
    try { await api(`/damages/${d.id}/notified`, { method: "POST" }); load(); onChange(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      {err && <div className="err">{err}</div>}
      {list.length === 0 && <div className="card muted">파손 보고가 없습니다.</div>}
      {list.map((d) => (
        <div className="card" key={d.id} style={d.status === "REPORTED" ? { borderColor: "var(--bad)" } : undefined}>
          <div className="row">
            {d.status === "REPORTED" ? (
              <><span className="chip bad">미확인</span><span className={`chip ${minsSince(d.createdAt) >= 30 ? "bad" : "warn"}`}>보고 후 {minsSince(d.createdAt)}분{minsSince(d.createdAt) >= 30 ? " · 30분 초과" : ""}</span></>
            ) : (
              <><span className="chip ok">확인됨</span><span className={`chip ${minsSince(d.createdAt, d.confirmedAt) > 30 ? "bad" : "ok"}`}>확인까지 {minsSince(d.createdAt, d.confirmedAt)}분</span></>
            )}
            <b>{d.shipper.name}</b><span className="muted">{d.item?.name ?? "품목 미지정"} · {d.qty}박스 · {d.reporter.name} · {fmtTime(d.createdAt)}</span>
          </div>
          <div className="diffbox chg">
            <b>어떤 물건인가요</b> · {d.item?.name ?? "품목 미지정"}
            {d.workOrder ? ` · 로트 ${d.workOrder.lotNo} · 위치 ${d.workOrder.location} · 예정 ${d.workOrder.expectedQty}개` : " · 입고 작업 연결 없음"}
            {d.labelNo ? ` · 라벨/송장 ${d.labelNo}` : ""}
          </div>
          <p style={{ margin: "8px 0" }}>{d.description}</p>
          {d.photo && <img src={d.photo} className="photo" alt="파손 사진" />}
          <h3 style={{ marginTop: 10 }}>지침서 기준 처리 방법 (AI가 찾은 근거)</h3>
          <div className="answer">{d.aiGuidance}</div>
          <Citations list={d.aiCitations} />
          <NotifyDue d={d} />
          {d.status === "REPORTED" ? (
            <div className="row" style={{ marginTop: 10 }}>
              <label className="row" style={{ margin: 0, color: "var(--ink)" }}><input type="checkbox" style={{ width: "auto" }} checked={!!notified[d.id]} onChange={(e) => setNotified({ ...notified, [d.id]: e.target.checked })} /> 화주사에 통보함</label>
              <input style={{ flex: 1, minWidth: 200 }} placeholder="처리 메모 (예: 격리 칸 이동, 화주사 통보 완료)" value={note[d.id] ?? ""} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} />
              <button className="btn" onClick={() => confirm(d)}>확인 처리</button>
            </div>
          ) : (
            <div className="row" style={{ marginTop: 8 }}>
              <p className="muted" style={{ margin: 0 }}>확인: {d.confirmedBy?.name} · {fmtTime(d.confirmedAt)} {d.managerNote ? `· ${d.managerNote}` : ""}</p>
              {!d.notifiedAt && <button className="btn ghost" onClick={() => markNotified(d)}>화주사 통보 완료 기록</button>}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function Inbound({ api, shippers, onChange }: { api: Api; shippers: any[]; onChange: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState<any>({ shipperId: "", itemId: "", expectedQty: "", location: "", expiryDate: "" });
  const [err, setErr] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const load = useCallback(() => api("/work-orders").then(setList).catch((e) => setErr(e.message)), [api]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (f.shipperId) api(`/items?shipperId=${f.shipperId}`).then(setItems); }, [f.shipperId, api]);
  const create = async () => {
    setErr("");
    try { await api("/work-orders", { method: "POST", body: { ...f, expectedQty: Number(f.expectedQty) } }); setF({ ...f, itemId: "", expectedQty: "", location: "" }); load(); onChange(); }
    catch (e: any) { setErr(e.message); }
  };
  const shown = onlyDiff ? list.filter((w) => w.diff !== null && w.diff !== 0) : list;
  return (
    <>
      <div className="card">
        <h2>입고 예정 등록 (작업지시)</h2>
        <div className="grid">
          <div><label>화주사</label><select value={f.shipperId} onChange={(e) => setF({ ...f, shipperId: e.target.value, itemId: "" })}><option value="">선택</option>{shippers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label>품목</label><select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">선택</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
          <div><label>예정 수량</label><input inputMode="numeric" value={f.expectedQty} onChange={(e) => setF({ ...f, expectedQty: e.target.value.replace(/[^0-9]/g, "") })} /></div>
          <div><label>보관 위치</label><input value={f.location} placeholder="예: C-01-04" onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
          <div><label>유통기한</label><input type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></div>
        </div>
        {err && <div className="err">{err}</div>}
        <div style={{ marginTop: 10 }}><button className="btn" onClick={create}>작업지시 만들기</button></div>
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>입고 내역</h2>
          <label className="row" style={{ margin: 0 }}><input type="checkbox" style={{ width: "auto" }} checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> 수량 차이만</label>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>화주사</th><th>품목</th><th>위치</th><th>예정</th><th>실제</th><th>차이</th><th>상태</th><th>작업자</th></tr></thead>
            <tbody>
              {shown.map((w) => (
                <tr key={w.id} className={w.diff ? "diff" : ""}>
                  <td>{w.shipper.name}</td><td>{w.item.name}</td><td>{w.location}</td><td>{w.expectedQty}</td><td>{w.actualQty ?? "-"}</td>
                  <td>{w.diff === null ? "-" : w.diff === 0 ? <span className="chip ok">일치</span> : <span className="chip bad">{w.diff > 0 ? "+" : ""}{w.diff}</span>}</td>
                  <td>{w.status === "DONE" ? `완료 ${fmtTime(w.completedAt)}` : "대기"}</td><td>{w.assignee?.name ?? "미배정"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Stock({ api, shippers, fixed }: { api: Api; shippers: any[]; fixed?: boolean }) {
  const [sid, setSid] = useState("");
  const [list, setList] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { api(`/stock${sid ? `?shipperId=${sid}` : ""}`).then(setList).catch((e) => setErr(e.message)); }, [sid, api]);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>재고</h2>
        {!fixed && <select style={{ width: 200 }} value={sid} onChange={(e) => setSid(e.target.value)}><option value="">전체 화주사</option>{shippers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      </div>
      {err && <div className="err">{err}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr>{!fixed && <th>화주사</th>}<th>품목</th><th>구역</th>{!fixed && <th>위치</th>}<th>로트</th><th>수량</th><th>입고일</th><th>유통기한</th></tr></thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id}>{!fixed && <td>{l.shipper.name}</td>}<td>{l.item.name}</td><td><span className={`chip ${l.item.zone}`}>{ZONE[l.item.zone]}</span></td>{!fixed && <td>{l.location}</td>}<td>{l.lotNo}</td><td><b>{l.qty}</b></td><td>{fmtDate(l.receivedAt)}</td><td>{fmtDate(l.expiryDate)}</td></tr>
            ))}
            {list.length === 0 && <tr><td colSpan={8} className="muted">재고가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Docs({ api, shippers }: { api: Api; shippers: any[] }) {
  const [list, setList] = useState<any[]>([]);
  const [f, setF] = useState<any>({ shipperId: "", kind: "GUIDE" });
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);
  const [open, setOpen] = useState<any>(null);
  const load = useCallback(() => api("/documents").then(setList).catch((e) => setErr(e.message)), [api]);
  useEffect(() => { load(); }, [load]);
  const upload = async () => {
    setBusy(true); setErr(""); setResult(null);
    try { setResult(await api("/documents", { method: "POST", body: { shipperId: Number(f.shipperId), kind: f.kind, content } })); load(); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <>
      <div className="card">
        <h2>새 판 올리기</h2>
        <p className="muted">텍스트(.md/.txt) 파일을 올리면 새 판이 현행이 되고, 예전 판은 보관됩니다. 바뀐 조항을 바로 보여 줍니다.</p>
        <div className="grid">
          <div><label>화주사</label><select value={f.shipperId} onChange={(e) => setF({ ...f, shipperId: e.target.value })}><option value="">선택</option>{shippers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label>종류</label><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="GUIDE">취급 지침서</option><option value="CONTRACT">보관 계약서</option></select></div>
          <div><label>파일</label><input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { setFileName(file.name); setContent(await file.text()); } }} /></div>
        </div>
        {fileName && <p className="muted">{fileName} · {content.length.toLocaleString()}자</p>}
        {err && <div className="err">{err}</div>}
        <div style={{ marginTop: 10 }}><button className="btn" disabled={!f.shipperId || !content || busy} onClick={upload}>{busy ? "분석 중..." : "올리고 비교하기"}</button></div>
        {result && <ChangeView doc={result} />}
      </div>
      <div className="card">
        <h2>문서 목록</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>화주사</th><th>종류</th><th>제목</th><th>판</th><th>상태</th><th>작업자 읽음</th><th>조항</th><th>올린 날</th><th></th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td>{d.shipper.name}</td><td>{d.kind === "GUIDE" ? "지침서" : "계약서"}</td><td>{d.title}</td><td>제{d.version}판</td>
                  <td>{d.isCurrent ? <span className="chip ok">현행</span> : <span className="chip">보관</span>}</td><td>{d.version > 1 ? `${d._count.acks}명` : "-"}</td><td>{d._count.chunks}</td><td>{fmtTime(d.createdAt)}</td>
                  <td><button className="btn ghost" onClick={async () => { const doc = await api(`/documents/${d.id}`); doc.ackInfo = d.version > 1 ? await api(`/documents/${d.id}/acks`) : null; setOpen(doc); }}>보기</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {open && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>{open.title} · 제{open.version}판</h2><button className="btn ghost" onClick={() => setOpen(null)}>닫기</button></div>
          {open.ackInfo && (
            <div className="diffbox chg"><b>작업자 읽음 확인 {open.ackInfo.read}/{open.ackInfo.total}명</b> · {open.ackInfo.workers.map((w: any) => `${w.name} ${w.ackedAt ? "✓ " + fmtTime(w.ackedAt) : "미확인"}`).join(" · ")}</div>
          )}
          {open.changeSummary && <ChangeView doc={open} />}
          {open.chunks.map((c: any, i: number) => <div className="cite" key={i}><b>{c.section}</b><div>{c.text}</div></div>)}
        </div>
      )}
    </>
  );
}

function ChangeView({ doc }: { doc: any }) {
  const c = doc.changeSummary;
  if (!c) return <div className="okmsg">{doc.title} 제{doc.version}판을 현행으로 등록했습니다 (첫 판).</div>;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="okmsg">제{c.fromVersion}판 → 제{doc.version}판 · 변경 {c.changed.length} · 추가 {c.added.length} · 삭제 {c.removed.length}</div>
      <h3>무엇이 바뀌었나 (요약)</h3>
      <div className="answer">{c.summary}</div>
      {c.changed.map((x: any, i: number) => <div className="diffbox chg" key={`c${i}`}><b>변경 · {x.section}</b><div>전: {x.before}</div><div>후: {x.after}</div></div>)}
      {c.added.map((x: any, i: number) => <div className="diffbox add" key={`a${i}`}><b>추가 · {x.section}</b><div>{x.after}</div></div>)}
      {c.removed.map((x: any, i: number) => <div className="diffbox del" key={`r${i}`}><b>삭제 · {x.section}</b><div>{x.before}</div></div>)}
    </div>
  );
}

// ───────── 화주사 ─────────
function ShipperView({ api, user }: { api: Api; user: User }) {
  const [tab, setTab] = useState<"stock" | "inbound" | "damage" | "inq">("stock");
  const [orders, setOrders] = useState<any[]>([]);
  const [damages, setDamages] = useState<any[]>([]);
  useEffect(() => { api("/work-orders").then(setOrders).catch(() => {}); api("/damages").then(setDamages).catch(() => {}); }, [api]);
  return (
    <div className="wrap">
      <p className="muted">{user.shipperName}의 물건만 보입니다. 다른 화주사 정보는 처리 서버에서 막습니다.</p>
      <div className="tabs">
        <button className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>내 재고</button>
        <button className={tab === "inbound" ? "on" : ""} onClick={() => setTab("inbound")}>입고 내역</button>
        <button className={tab === "damage" ? "on" : ""} onClick={() => setTab("damage")}>파손 보고 {damages.length}</button>
        <button className={tab === "inq" ? "on" : ""} onClick={() => setTab("inq")}>센터 문의함</button>
      </div>
      {tab === "inq" && <ShipperInquiries api={api} />}
      {tab === "stock" && <Stock api={api} shippers={[]} fixed />}
      {tab === "inbound" && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>품목</th><th>예정</th><th>실제</th><th>차이</th><th>상태</th></tr></thead>
            <tbody>{orders.map((w) => <tr key={w.id} className={w.diff ? "diff" : ""}><td>{w.item.name}</td><td>{w.expectedQty}</td><td>{w.actualQty ?? "-"}</td><td>{w.diff === null ? "-" : w.diff}</td><td>{w.status === "DONE" ? `완료 ${fmtTime(w.completedAt)}` : "입고 예정"}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {tab === "damage" && (
        <>
          {damages.length === 0 && <div className="card muted">파손 보고가 없습니다.</div>}
          {damages.map((d) => (
            <div className="card" key={d.id}>
              <div className="row">{d.status === "REPORTED" ? <span className="chip warn">센터 확인 중</span> : <span className="chip ok">센터 확인 완료</span>}<b>{d.item?.name ?? "품목 미지정"}</b><span className="muted">{d.qty}박스 · {fmtTime(d.createdAt)}</span></div>
              <p>{d.description}</p>
              {d.photo && <img src={d.photo} className="photo" alt="파손 사진" />}
              {d.notifiedAt && <p className="muted">센터 통보: {fmtTime(d.notifiedAt)}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** 화주사: 센터 문의함 (관리자가 보낸 문의만, 답 입력 → 전송) */
function ShipperInquiries({ api }: { api: Api }) {
  const [list, setList] = useState<any[]>([]);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [err, setErr] = useState("");
  const load = useCallback(() => api("/shipper-inquiries").then(setList).catch((e) => setErr(e.message)), [api]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      {err && <div className="err">{err}</div>}
      {list.length === 0 && <div className="card muted">센터에서 온 문의가 없습니다.</div>}
      {list.map((q) => (
        <div className="card" key={q.id}>
          <div className="row">{q.answer ? <span className="chip ok">답변 보냄</span> : <span className="chip warn">답변 필요</span>}<span className="muted">센터 문의 · {fmtTime(q.askedAt)}</span></div>
          <p style={{ margin: "8px 0", fontSize: 16 }}>{q.message}</p>
          {q.answer ? (
            <div className="answer">{q.answer}<div className="muted" style={{ marginTop: 4 }}>보낸 시각 {fmtTime(q.answeredAt)}</div></div>
          ) : (
            <>
              <textarea value={ans[q.id] ?? ""} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} placeholder="센터에 보낼 답을 적어 주세요" />
              <button className="btn" disabled={!(ans[q.id] ?? "").trim()} onClick={async () => {
                setErr("");
                try { await api(`/shipper-inquiries/${q.id}/reply`, { method: "POST", body: { answer: ans[q.id] } }); load(); }
                catch (e: any) { setErr(e.message); }
              }}>전송</button>
            </>
          )}
        </div>
      ))}
    </>
  );
}
