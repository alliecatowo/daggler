---
layout: home
hero:
  name: "Daggler"
  text: "A semantic workbench for GitHub Actions"
  tagline: Parse workflows into a typed IR, see the job graph, validate it in layers, and catch security problems before they ship.
  image:
    src: ../images/editor.png
    alt: The Daggler editor
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: CLI reference
      link: /reference/cli
features:
  - title: Understand
    details: Workflow YAML becomes a typed IR with a source map, so every finding points at an exact line and column.
  - title: Validate
    details: Five validation layers, from schema to expressions to graph semantics to action inputs.
  - title: Secure
    details: 13 policy rules, including prompt-injection checks for AI-agent workflows, and a graded security posture score.
  - title: Runs client-side
    details: The whole parse, graph and validate pipeline is pure TypeScript with no backend.
---
