# 한빛 WMS Lite · 한빛물류 이천센터

화주사 18곳마다 다른 취급 규칙을 작업자 휴대폰과 관리자 화면에서 바로 찾고 지키게 하는 창고 업무 앱입니다. (FDE 빌더 해커톤, 고객사 13번)

## 기능
- 입고 작업지시 → 작업자가 휴대폰으로 실제 수량 입력·완료 → 예정과 다르면 "차이" 표시
- 파손 즉시 보고(사진) → 관리자 파손함 배지 → 확인 처리. 보고 순간 그 화주사 지침서의 파손 처리 방법을 근거 조항과 함께 자동 첨부
- 화주사별 근거 Q&A: 고른 화주사의 현행 지침서·계약서에서만 찾아 답하고 근거 조항 표시
- 지침서 새 판 업로드 → 예전 판 보관 + 바뀐 조항(변경·추가·삭제)과 요약
- 역할 권한: 센터장·관리자·작업자·화주사. 화주사는 자기 재고만(서버에서 403)

## 구조
- `apps/web` Next.js 화면 · `apps/api` NestJS + Prisma 처리 서버 · PostgreSQL
- AI: OpenAI (임베딩 text-embedding-3-small, 답변 gpt-4o-mini). 키가 없으면 키워드 검색 + 원문 표시로 동작

## 실행
1. `apps/api/.env`: `DATABASE_URL`, `OPENAI_API_KEY`, `ALLOWED_ORIGIN=http://localhost:3000`
2. `apps/web/.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:4000`
3. `npm run setup` → `npm run db:push` → `npm run db:sample`
4. `npm run dev:api`, `npm run dev:web`

시연 계정: center(센터장), choi·kim(관리자), jang·nguyen(작업자), fresh·beauty·frozen(화주사) / 비밀번호 demo1234
시연용 개정판: `apps/api/prisma/seed-docs/FROZEN_취급지침서_v2.md`를 관리자 > 지침서·계약서에서 한겨울푸드·지침서로 올립니다.

모든 화주사·인물·문서는 교육용 가상 자료입니다.
