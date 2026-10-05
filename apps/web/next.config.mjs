// Hosted demo: a fully static export (no server, no API routes) served under a
// sub-path of GitHub Pages. See scripts/build-hosted.mjs.
const hosted = process.env.NEXT_PUBLIC_DAGGLER_HOSTED === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const dev = process.env.NODE_ENV !== "production";

// Security headers for the self-hosted server (a static export on GitHub Pages
// cannot set headers). Inline scripts are needed by Next's bootstrap; everything
// else is same-origin. Monaco is served from /monaco (scripts/copy-monaco.mjs).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://github.com",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(hosted
    ? {}
    : {
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }),
  ...(hosted
    ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
    : {}),
  ...(basePath ? { basePath } : {}),
  transpilePackages: [
    "@daggler/ai",
    "@daggler/github",
    "@daggler/inventory",
    "@daggler/workflow-ir",
    "@daggler/validators",
    "@daggler/db",
    "@daggler/runner",
    "@daggler/runner-protocol",
    "@daggler/simulate",
    "@daggler/worker",
  ],
  typescript: {
    // Types are checked by `pnpm typecheck`; don't block production builds on it.
    ignoreBuildErrors: false,
  },
  webpack(config) {
    // Allow webpack to resolve .js imports as .ts/.tsx (ESM-style TypeScript packages).
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
