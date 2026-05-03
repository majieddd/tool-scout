import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Tool Scout — Catalog of Claude-compatible developer tools",
  description:
    "Daily-crawled catalog of MCP servers, Claude Code plugins, skills, and useful CLIs. Letter-graded against a personal profile. Click any tool to request a Claude Code wrapper.",
  metadataBase: new URL("https://majieddd.github.io/tool-scout"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Tool Scout",
    description:
      "Daily catalog of Claude-compatible MCP servers, plugins, and skills — letter graded.",
    type: "website",
    url: "https://majieddd.github.io/tool-scout/",
    siteName: "Tool Scout",
  },
  twitter: {
    card: "summary",
    title: "Tool Scout",
    description: "Daily-crawled catalog of Claude-compatible developer tools.",
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
