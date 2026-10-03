import { defineConfig } from "vitepress";

// GitHub Pages serves project sites under /<repo>/. Set DOCS_BASE=/ for a custom domain.
export default defineConfig({
  title: "Daggler",
  description: "A semantic workbench for GitHub Actions: parse, graph, validate and secure workflows.",
  base: process.env.DOCS_BASE ?? "/daggler/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "CLI", link: "/reference/cli" },
      { text: "npm", link: "https://www.npmjs.com/package/daggler-cli" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Web editor", link: "/guide/web-editor" },
          { text: "Confidence ladder", link: "/guide/confidence-ladder" },
          { text: "Self-hosting status", link: "/guide/self-hosting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Validation layers", link: "/reference/validation" },
          { text: "Policy rules", link: "/reference/policy-rules" },
          { text: "Architecture", link: "/reference/architecture" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/alliecatowo/daggler" }],
    search: { provider: "local" },
  },
});
