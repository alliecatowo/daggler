/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@daggler/workflow-ir",
    "@daggler/validators",
    "@daggler/db",
    "@daggler/runner",
    "@daggler/runner-protocol",
    "@daggler/simulate",
  ],
  eslint: {
    ignoreDuringBuilds: true,
  },
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
