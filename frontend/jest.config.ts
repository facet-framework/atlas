import type { Config } from "jest";

/** Standalone reader and bundled-plugin tests; strict type checking runs separately. */
const config: Config = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "\\.css$": "<rootDir>/test/styleMock.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.(js|ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          verbatimModuleSyntax: false,
          noUnusedLocals: false,
        },
      },
    ],
  },
  moduleDirectories: ["node_modules", "<rootDir>/node_modules"],
  testMatch: ["<rootDir>/src/**/*.spec.{ts,tsx}", "<rootDir>/../plugins/**/*.spec.{ts,tsx}"],
  roots: ["<rootDir>/src", "<rootDir>/../plugins"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.stories.tsx",
    "!src/app/**",
    "!src/fixtures/**",
    "!src/model/fixtures/**",
  ],
  coverageThreshold: {
    global: { statements: 72, branches: 62, functions: 70, lines: 74 },
    "./src/screens/": { statements: 94, branches: 90, functions: 96, lines: 95 },
    "./src/derive.ts": {
      statements: 92,
      branches: 85,
      functions: 95,
      lines: 92,
    },
  },
};

export default config;
