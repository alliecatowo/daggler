import { defineConfig } from "vitepress";

// GitHub Pages serves project sites under /<repo>/. Set DOCS_BASE=/ for a custom domain.
export default defineConfig({
  title: "Daggler",
  description: "A semantic workbench for GitHub Actions: parse, graph, validate and secure workflows.",
  base: process.env.DOCS_BASE ?? "/daggler/",
  cleanUrls: true,
  lastUpdated: true,
  // /app/ is the static web editor, copied into the site by the docs workflow.
  ignoreDeadLinks: [/\/app\//],
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/daggler/favicon.svg" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
    ],
  ],
  themeConfig: {
    logo: { light: "/logo-light.svg", dark: "/logo-dark.svg", alt: "" },
    nav: [
      { text: "Try it", link: "/app/editor/", target: "_self" },
      { text: "Guide", link: "/guide/getting-started" },
      { text: "CLI", link: "/reference/cli" },
      { text: "Rules", link: "/reference/policy-rules" },
      { text: "npm", link: "https://www.npmjs.com/package/daggler-cli" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Hosted editor", link: "/guide/web-editor" },
          { text: "Confidence ladder", link: "/guide/confidence-ladder" },
          { text: "Self-hosting", link: "/guide/self-hosting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Policy rules", link: "/reference/policy-rules" },
          { text: "Validation layers", link: "/reference/validation" },
          { text: "Architecture", link: "/reference/architecture" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/alliecatowo/daggler" }],
    search: { provider: "local" },
  },
});
