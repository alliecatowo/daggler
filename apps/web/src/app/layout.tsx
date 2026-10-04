import type { Metadata, Viewport } from "next";
import "./globals.css";
import { connection } from "next/server";
import { getLaunchToken } from "../lib/guard";
import { HOSTED } from "../lib/hosted";

export const metadata: Metadata = {
  title: "Daggler — the semantic IDE for GitHub Actions",
  description:
    "Visualize, validate, secure, and ship GitHub Actions workflows. Native YAML. No lock-in. Self-hostable.",
  applicationName: "Daggler",
};

export const viewport: Viewport = {
  themeColor: "#1a1a22",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The token is generated per server launch, so the local app must never be
  // prerendered. The hosted demo is a static export with no API and no token.
  let token = "";
  if (!HOSTED) {
    await connection();
    token = getLaunchToken();
  }
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {!HOSTED && <meta name="daggler-token" content={token} />}
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
