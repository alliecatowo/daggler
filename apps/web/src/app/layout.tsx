import type { Metadata, Viewport } from "next";
import "./globals.css";

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
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
