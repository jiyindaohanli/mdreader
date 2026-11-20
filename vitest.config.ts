import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The preview pipeline sanitizes through DOMPurify, which needs a DOM.
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
