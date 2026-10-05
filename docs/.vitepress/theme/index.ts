import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import DagHome from "./DagHome.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DagHome", DagHome);
  },
} satisfies Theme;
