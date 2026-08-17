import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "金币武器大战 | 双人同屏格斗",
  description: "选择战士、赢取金币、解锁武器，与朋友来一场双人同屏大乱斗。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
