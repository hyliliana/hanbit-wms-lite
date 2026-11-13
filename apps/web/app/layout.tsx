import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "한빛 WMS Lite",
  description: "한빛물류 이천센터 · 화주사별 규칙을 현장에서 바로 찾고 지키는 창고 업무 앱",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
