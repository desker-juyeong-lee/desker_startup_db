import type { Metadata } from "next";
export const metadata: Metadata = { title: "스타트업 DB 자동 업데이트" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f5f5f5" }}>
        {children}
      </body>
    </html>
  );
}
