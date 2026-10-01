import { readFileSync } from "node:fs";
import base from "./stryker.base.config.mjs";
const path = "src/core/draft-source-sync.ts";
const lines = readFileSync(path, "utf8").split("\n");
const start =
  lines.findIndex((line) =>
    line.startsWith("export function observedDraftShipment"),
  ) + 1;
const end = lines.findIndex((line) =>
  line.startsWith("export async function lockDraftSourcePlans"),
);
if (start < 1 || end <= start) throw new Error("DRAFT_POLICY_RANGE_INVALID");
const publicationPath = "src/core/route-publication-content.ts";
const publicationLines = readFileSync(publicationPath, "utf8").split("\n");
const publicationStart =
  publicationLines.findIndex((line) =>
    line.startsWith("export function routePublicationSourceChanged"),
  ) + 1;
const publicationEnd = publicationLines.findIndex((line) =>
  line.startsWith("export function routePublicationContentChanged"),
);
if (publicationStart < 1 || publicationEnd <= publicationStart)
  throw new Error("PUBLICATION_SOURCE_RANGE_INVALID");
const config = {
  ...base,
  mutate: [
    `${path}:${start}-${end}`,
    `${publicationPath}:${publicationStart}-${publicationEnd}`,
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.draft-source-policy.config.ts" },
  reporters: ["progress", "clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/draft-source.html" },
  jsonReporter: { fileName: "reports/mutation/draft-source.json" },
  concurrency: 3,
  coverageAnalysis: "off",
  thresholds: { high: 95, low: 90, break: 90 },
};
export default config;
