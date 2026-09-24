import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["tests/browser-qa.mjs"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "process",
          "Buffer",
          "URL",
          "sessionStorage",
          "document",
          "innerWidth",
          "console",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
