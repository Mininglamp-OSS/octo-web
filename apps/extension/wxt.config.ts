import { defineConfig } from "wxt";
import tsconfigPaths from "vite-tsconfig-paths";
import commonjs from "vite-plugin-commonjs";
import path from "path";
import { enterpriseModulesPlugin } from "../web/vite.enterpriseHtml";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
  webExt: {
    disabled: true,
  },
  autoIcons: {
    developmentIndicator: false,
  },
  vite: () => ({
    plugins: [
      enterpriseModulesPlugin(undefined, path.resolve(__dirname, "../web")),
      commonjs(),
      tsconfigPaths({ root: "../../" }),
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@web": path.resolve(__dirname, "../web/src"),
      },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
      "process.env.PUBLIC_URL": '""',
    },
  }),
  manifest: {
    side_panel: {
      default_path: "entrypoints/sidepanel/index.html",
    },
    options_ui: {
      page: "entrypoints/options/index.html",
      open_in_tab: true,
    },
    permissions: ["notifications", "storage", "offscreen", "sidePanel", "contextMenus"],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: ["/injected*.js"],
        matches: ["<all_urls>"],
      },
    ],
    action: {},
  },
});
