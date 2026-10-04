import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getLaunchToken } from "../lib/guard";

// The token is generated per server launch, so never prerender this layout.
export const dynamic = "force-dynamic";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="daggler-token" content={getLaunchToken()} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
