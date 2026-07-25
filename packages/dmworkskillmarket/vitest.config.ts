import { defineConfig } from "vitest/config";
import path from "path";

const root = path.resolve(__dirname, "../..");
const pnpm = path.resolve(root, "node_modules/.pnpm");
const react18 = path.resolve(pnpm, "react@18.3.1/node_modules/react");
const reactDom18 = path.resolve(pnpm, "react-dom@18.3.1_react@18.3.1/node_modules/react-dom");
const testingLibraryReact = path.resolve(
  pnpm,
  "@testing-library+react@14.3.1_@types+react@18.3.28_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/@testing-library/react",
);

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
    setupFiles: ["src/__tests__/setup.ts"],
    css: false,
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@octo/base", replacement: path.resolve(__dirname, "src/__mocks__/dmworkBase.tsx") },
      { find: /^@testing-library\/react$/, replacement: testingLibraryReact },
      { find: /^react-dom\/(.*)/, replacement: reactDom18 + "/$1" },
      { find: /^react-dom$/, replacement: reactDom18 },
      { find: /^react\/(.*)/, replacement: react18 + "/$1" },
      { find: /^react$/, replacement: react18 },
    ],
  },
});
