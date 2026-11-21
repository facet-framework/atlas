import js from "@eslint/js";
import jest from "eslint-plugin-jest";
import a11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Lint the standalone reader without a development web-framework dependency. */
export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    plugins: { react, "react-hooks": reactHooks, "jsx-a11y": a11y },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs["recommended-latest"].rules,
      ...a11y.flatConfigs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "react/prop-types": "off",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.spec.{ts,tsx}", "**/jest.setup.ts"],
    plugins: { jest },
    languageOptions: { globals: globals.jest },
    rules: {
      ...jest.configs["flat/recommended"].rules,
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["*.{ts,mjs,js}", "scripts/*.{mjs,js}"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
  {
    files: ["src/standalone/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
);
