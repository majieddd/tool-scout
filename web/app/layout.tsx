import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Tool Scout — Catalog of Claude-compatible developer tools",
  description:
    "Daily-crawled catalog of MCP servers, Claude Code plugins, skills, and useful CLIs. Letter-graded against a personal profile, request a Claude wrapper for any tool.",
  metadataBase: new URL("https://tool-scout.vercel.app"),
  openGraph: {
    title: "Tool Scout",
    description: "Catalog of Claude-compatible developer tools.",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-ink antialiased flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
