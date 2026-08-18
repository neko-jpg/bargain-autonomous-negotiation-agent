import type { Metadata } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-jp",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "Project BARGAIN — Autonomous Negotiation Agent",
  description: "C2Cマーケットプレイス向け 自律型価格交渉AIエージェント",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`}>
      <body className="antialiased selection:bg-teal-100 selection:text-teal-950">
        {children}
      </body>
    </html>
  );
}
