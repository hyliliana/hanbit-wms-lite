# 한빛 WMS Lite (스타터: 숨 스튜디오)

FDE 빌더 1주차 수업용 저장소다. 필라테스 스튜디오 "숨"(가상, 지점: 강남점·홍대점·성수점)의 예약 웹앱을 만든다.
이 저장소로 실습하는 수강생은 개발을 모른다. 설명은 쉬운 말로 하고, 코드보다 "무엇이 바뀌었고 화면에서 어떻게 확인하는지"를 먼저 말한다.

## 구조
- apps/web: 화면 서버 (Next.js, App Router). 로컬 주소 http://localhost:3000
- apps/api: 처리 서버 (NestJS + Prisma). 로컬 주소 http://localhost:4000 , 상태 확인 GET /health
- apps/api/prisma/schema.prisma: DB 구조. 기본 구조(지점, 강사, 수업, 회원, 회원권, 예약)가 들어 있다.
  수강생이 구글 시트로 설계한 구조를 주면, 그 구조에 맞게 이 파일을 고친 뒤 `npm run db:push`로 DB에 반영한다.
- apps/api/prisma/sample.ts: 가상 데이터 넣기. 기존 데이터를 지우고 지난 2주와 앞으로 3주의 수업·회원·회원권·예약을 넣는다.
  DB 구조를 바꿨다면 sample.ts도 바뀐 구조에 맞게 고친 뒤 실행한다.

## 처음 준비
1. apps/api/.env 를 만들고 DATABASE_URL을 넣는다 (.env.example 참고). 내 PC에서는 Render Postgres의 External(외부) 주소를 쓴다.
2. apps/web/.env.local 을 만들고 NEXT_PUBLIC_API_URL=http://localhost:4000 을 넣는다.
3. npm run setup → npm run db:push → (필요하면) npm run db:sample
4. npm run dev:api 와 npm run dev:web 을 각각 켠다.

## 지킬 것
- 규칙(정원, 회원권 남은 횟수, 같은 수업 중복 예약 금지)은 처리 서버(apps/api)에서 지킨다. 화면에서만 막지 않는다.
- DB 주소와 비밀번호, AI 키 같은 열쇠는 처리 서버의 .env에만 둔다. 화면(apps/web)에는 두지 않는다. .env 파일은 GitHub에 올리지 않는다.
- 처리 서버는 PORT 환경변수의 포트로 켠다 (Render가 정해 준다). 없으면 4000.
- 화면 서버는 NEXT_PUBLIC_API_URL로 처리 서버를 찾는다.
- 처리 서버는 ALLOWED_ORIGIN에 적힌 화면 주소에서 온 요청만 받는다 (CORS). 여러 개면 쉼표로 적는다.
- 회원 이름과 전화번호는 꼭 필요한 화면이 아니면 보여 주지 않는다.

## 배포
- Render (처리 서버, Web Service)
  - Root Directory: apps/api
  - Build Command: npm install && npm run build
  - Start Command: npm run start:prod
  - 환경변수: DATABASE_URL (Render Postgres의 Internal 주소), ALLOWED_ORIGIN (Vercel 화면 주소)
  - 지역은 Render Postgres와 같은 곳으로 고른다.
- Vercel (화면 서버)
  - Root Directory: apps/web
  - 환경변수: NEXT_PUBLIC_API_URL (Render 처리 서버 주소)
