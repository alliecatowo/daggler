// Hosted demo: a fully static export (no server, no API routes) served under a
// sub-path of GitHub Pages. See scripts/build-hosted.mjs.
const hosted = process.env.NEXT_PUBLIC_DAGGLER_HOSTED === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
