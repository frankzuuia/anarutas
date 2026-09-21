import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_IGNORE_PATTERNS = [
  ".local/**",
  ".next/**",
  "coverage/**",
  "reports/**",
  "test-results/**",
  "playwright-report/**",
];

const DERIVED_CONFIG_FILES = [
  "stryker.group-persistence.config.mjs",
  "stryker.route-incidents-query.config.mjs",
];

type StrykerConfig = {
  cleanTempDir?: unknown;
  ignorePatterns?: unknown;
};

function discoverStrykerConfigFiles(): string[] {
  return readdirSync(projectRoot)
    .filter((entry) => /^stryker.*\.config\.mjs$/.test(entry))
    .sort();
}

describe("Stryker storage hygiene", () => {
  const configFiles = discoverStrykerConfigFiles();

  it("discovers a non-empty set that includes both derived configs", () => {
    expect(configFiles.length).toBeGreaterThan(0);
    expect(configFiles).toEqual(expect.arrayContaining(DERIVED_CONFIG_FILES));
  });

  it.each(configFiles)(
    "%s default export uses cleanTempDir 'always' and every required ignore pattern",
    async (configFile) => {
      const configUrl = pathToFileURL(resolve(projectRoot, configFile)).href;
      const configModule = (await import(/* @vite-ignore */ configUrl)) as {
        default?: StrykerConfig;
      };

      const config = configModule.default;
      expect(config).toBeDefined();
      expect(config?.cleanTempDir).toBe("always");

      const ignorePatterns = config?.ignorePatterns;
      expect(Array.isArray(ignorePatterns)).toBe(true);
      expect(ignorePatterns).toEqual(
        expect.arrayContaining(REQUIRED_IGNORE_PATTERNS),
      );
    },
  );
});
