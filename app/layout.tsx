import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alaçam Dağıtım · Dijital Katalog",
  description: "Ürünleri ve markaları keşfedin, sipariş listenizi hazırlayın.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
