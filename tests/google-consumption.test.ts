import { describe, expect, it, vi } from "vitest";
import { readGoogleConsumptionConfig } from "../src/core/google-consumption-config";
import {
  aggregateConsumptionRows,
  consumptionQuery,
  discoverBillingTables,
  requestGoogleConsumption,
} from "../src/core/google-consumption-bigquery";

const fields = [
  "row_type",
  "current_period",
  "usage_day",
  "period_start",
  "sku_id",
  "sku_description",
  "service_description",
  "units",
  "gross_cost",
  "credits",
  "currency",
  "provider_export_time",
  "pricing_as_of_time",
  "pricing_unit",
  "free_limit",
  "next_tier_price",
  "next_tier_quantity",
] as const;

type WireRow = Parameters<typeof aggregateConsumptionRows>[0][number];

function serviceAccount(project = "finops-project") {
  return Buffer.from(
    JSON.stringify({
      type: "service_account",
      project_id: project,
      client_email: `consumption@${project}.iam.gserviceaccount.com`,
      private_key:
        "-----BEGIN PRIVATE KEY-----\nQA\n-----END PRIVATE KEY-----\n",
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  ).toString("base64");
}

function environment() {
  return {
    RUTAS_GOOGLE_CLOUD_PROJECT_ID: "ana-rutas-develop",
    RUTAS_GOOGLE_FINOPS_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount(),
    RUTAS_GOOGLE_BILLING_EXPORT_PROJECT_ID: "finops-project",
    RUTAS_GOOGLE_BILLING_EXPORT_DATASET_ID: "billing_export",
    RUTAS_GOOGLE_BILLING_EXPORT_LOCATION: "US",
  };
}

function config() {
  const value = readGoogleConsumptionConfig(environment());
  if (!value) throw new Error("CONFIG_EXPECTED");
  return value;
}

function row(values: (string | null)[]) {
  return { f: values.map((value) => ({ v: value })) };
}

function meta(overrides: Partial<WireRow> = {}): WireRow {
  const values: Record<(typeof fields)[number], string | null> = {
    row_type: "meta",
    current_period: "2026-09-01",
    usage_day: null,
    period_start: null,
    sku_id: null,
    sku_description: null,
    service_description: null,
    units: null,
    gross_cost: null,
    credits: null,
    currency: "MXN",
    provider_export_time: "2026-09-11T16:00:00.000Z",
    pricing_as_of_time: "2026-09-11T00:00:00.000Z",
    pricing_unit: null,
    free_limit: null,
    next_tier_price: null,
    next_tier_quantity: null,
    ...overrides,
  };
  return values as WireRow;
}

function usage(
  sku: string,
  day: string,
  units: number,
  options: {
    period?: string;
    name?: string;
    gross?: number;
    credits?: number;
    currency?: string;
    free?: number | null;
  } = {},
): WireRow {
  const values: Record<(typeof fields)[number], string | null> = {
    row_type: "usage",
    current_period: "2026-09-01",
    usage_day: day,
    period_start: options.period || "2026-09-01",
    sku_id: sku,
    sku_description: options.name || sku,
    service_description: "Google Maps Platform",
    units: String(units),
    gross_cost: String(options.gross || 0),
    credits: String(options.credits || 0),
    currency: options.currency || "MXN",
    provider_export_time: "2026-09-11T16:00:00.000Z",
    pricing_as_of_time: "2026-09-11T00:00:00.000Z",
    pricing_unit: "COUNT",
    free_limit: options.free === null ? null : String(options.free ?? 10_000),
    next_tier_price: "140",
    next_tier_quantity: "1000",
  };
  return values as WireRow;
}

function queryResponse(rows: Record<string, string | null>[], extra = {}) {
  return {
    jobComplete: true,
    jobReference: {
      projectId: "finops-project",
      jobId: "job-1",
      location: "US",
    },
    schema: { fields: fields.map((name) => ({ name })) },
    rows: rows.map((value) => row(fields.map((name) => value[name]))),
    ...extra,
  };
}

describe("Google consumption configuration", () => {
  it("is explicitly unconfigured when the FinOps envelope is absent", () => {
    expect(
      readGoogleConsumptionConfig({
        RUTAS_GOOGLE_CLOUD_PROJECT_ID: "ana-rutas-develop",
      }),
    ).toBeNull();
  });

  it("accepts a separate service account and bounded query guardrails", () => {
    expect(
      readGoogleConsumptionConfig({
        ...environment(),
        RUTAS_GOOGLE_CONSUMPTION_SYNC_MINUTES: "15",
        RUTAS_GOOGLE_BIGQUERY_MAX_BYTES_BILLED: "50000000",
      }),
    ).toMatchObject({
      mapsProjectId: "ana-rutas-develop",
      queryProjectId: "finops-project",
      datasetId: "billing_export",
      location: "US",
      syncMinutes: 15,
      maximumBytesBilled: 50_000_000,
    });
  });

  it.each([
    { RUTAS_GOOGLE_BILLING_EXPORT_DATASET_ID: undefined },
    { RUTAS_GOOGLE_BILLING_EXPORT_DATASET_ID: "bad.dataset" },
    { RUTAS_GOOGLE_BILLING_EXPORT_PROJECT_ID: "UPPER" },
    { RUTAS_GOOGLE_BILLING_EXPORT_LOCATION: "US;DROP" },
    { RUTAS_GOOGLE_CONSUMPTION_SYNC_MINUTES: "0" },
    { RUTAS_GOOGLE_BIGQUERY_MAX_BYTES_BILLED: "NaN" },
  ])("fails closed for partial or unsafe FinOps config %j", (changed) => {
    expect(() =>
      readGoogleConsumptionConfig({ ...environment(), ...changed }),
    ).toThrow("GOOGLE_CONSUMPTION_CONFIG_INVALID");
  });

  it("trims provider identifiers and accepts the documented numeric maxima", () => {
    expect(
      readGoogleConsumptionConfig({
        ...environment(),
        RUTAS_GOOGLE_CLOUD_PROJECT_ID: " ana-rutas-develop ",
        RUTAS_GOOGLE_BILLING_EXPORT_PROJECT_ID: " finops-project ",
        RUTAS_GOOGLE_BILLING_EXPORT_DATASET_ID: " billing_export ",
        RUTAS_GOOGLE_BILLING_EXPORT_LOCATION: " US ",
        RUTAS_GOOGLE_CONSUMPTION_SYNC_MINUTES: "1440",
        RUTAS_GOOGLE_BIGQUERY_MAX_BYTES_BILLED: "1000000000000",
      }),
    ).toMatchObject({
      mapsProjectId: "ana-rutas-develop",
      queryProjectId: "finops-project",
      datasetId: "billing_export",
      location: "US",
      syncMinutes: 1440,
      maximumBytesBilled: 1_000_000_000_000,
    });
  });

  it.each([
    { RUTAS_GOOGLE_CLOUD_PROJECT_ID: undefined },
    { RUTAS_GOOGLE_CLOUD_PROJECT_ID: "" },
    { RUTAS_GOOGLE_CLOUD_PROJECT_ID: "a".repeat(201) },
    { RUTAS_GOOGLE_BILLING_EXPORT_PROJECT_ID: "a".repeat(201) },
    { RUTAS_GOOGLE_BILLING_EXPORT_DATASET_ID: "a".repeat(1025) },
    { RUTAS_GOOGLE_BILLING_EXPORT_LOCATION: "a".repeat(101) },
    { RUTAS_GOOGLE_CONSUMPTION_SYNC_MINUTES: "1441" },
    { RUTAS_GOOGLE_BIGQUERY_MAX_BYTES_BILLED: "1000000000001" },
  ])(
    "rejects identifier and numeric values beyond exact limits %j",
    (changed) => {
      expect(() =>
        readGoogleConsumptionConfig({ ...environment(), ...changed }),
      ).toThrow("GOOGLE_CONSUMPTION_CONFIG_INVALID");
    },
  );
});

describe("Google BigQuery consumption contract", () => {
  it("discovers the official exports across pages without choosing an ambiguous table", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tables: [
              {
                tableReference: {
                  tableId: "gcp_billing_export_v1_000000_000000_000000",
                },
              },
            ],
            nextPageToken: "next",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tables: [{ tableReference: { tableId: "cloud_pricing_export" } }],
          }),
        ),
      );
    await expect(
      discoverBillingTables(config(), {
        fetch: fetcher as typeof fetch,
        token: async () => "oauth",
      }),
    ).resolves.toMatchObject({
      standard: "gcp_billing_export_v1_000000_000000_000000",
      pricing: "cloud_pricing_export",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain("pageToken=next");
  });

  it("requires exactly one standard export and the pricing export", async () => {
    for (const tables of [
      [],
      ["gcp_billing_export_v1_a"],
      [
        "gcp_billing_export_v1_a",
        "gcp_billing_export_v1_b",
        "cloud_pricing_export",
      ],
    ]) {
      const fetcher = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tables: tables.map((id) => ({
              tableReference: { tableId: id },
            })),
          }),
        ),
      );
      await expect(
        discoverBillingTables(config(), {
          fetch: fetcher as typeof fetch,
          token: async () => "oauth",
        }),
      ).rejects.toThrow("GOOGLE_CONSUMPTION_EXPORT_MISSING");
    }
  });

  it("builds a provider query that filters Maps pricing and parameterizes the target project", () => {
    const query = consumptionQuery(
      config(),
      "gcp_billing_export_v1_account",
      "cloud_pricing_export",
    );
    expect(query).toContain("business_entity_name = 'Maps'");
    expect(query).toContain("b.project.id = @mapsProjectId");
    expect(query).toContain("b.export_time >= TIMESTAMP(");
    expect(query).toContain("US/Pacific");
    expect(query).toContain(
      "`finops-project.billing_export.gcp_billing_export_v1_account`",
    );
    expect(query).not.toContain("ana-rutas-develop");
    expect(() =>
      consumptionQuery(config(), "bad.table", "cloud_pricing_export"),
    ).toThrow("GOOGLE_CONSUMPTION_RESPONSE_INVALID");
  });

  it("aggregates official daily rows by month and independent SKU", () => {
    const snapshot = aggregateConsumptionRows(
      [
        meta(),
        usage("dynamic-maps", "2026-09-10", 15, {
          name: "Dynamic Maps",
        }),
        usage("dynamic-maps", "2026-09-11", 25, {
          name: "Dynamic Maps",
        }),
        usage("fleet", "2026-09-11", 84, {
          name: "Fleet Routing",
          free: 1000,
        }),
        usage("dynamic-maps", "2026-08-31", 10, {
          period: "2026-08-01",
          gross: 5,
          credits: -2,
        }),
      ],
      "ana-rutas-develop",
    );
    expect(snapshot).toMatchObject({
      mapsProjectId: "ana-rutas-develop",
      currentPeriod: "2026-09-01",
      currency: "MXN",
      grossCost: 0,
      credits: 0,
      netCost: 0,
      maximumPercentage: 8.4,
    });
    expect(snapshot.skus).toEqual([
      expect.objectContaining({
        skuId: "fleet",
        usage: 84,
        freeLimit: 1000,
        remaining: 916,
        percentage: 8.4,
        level: "healthy",
      }),
      expect.objectContaining({
        skuId: "dynamic-maps",
        usage: 40,
        freeLimit: 10_000,
        remaining: 9960,
        percentage: 0.4,
      }),
    ]);
    expect(snapshot.days).toEqual([
      expect.objectContaining({ date: "2026-08-31", netCost: 3 }),
      expect.objectContaining({ date: "2026-09-10", netCost: 0 }),
      expect.objectContaining({ date: "2026-09-11", netCost: 0 }),
    ]);
    expect(snapshot.months[0]).toEqual(
      expect.objectContaining({ periodStart: "2026-08-01", netCost: 3 }),
    );
  });

  it("marks charging and unpriced SKUs without inventing a free limit", () => {
    const snapshot = aggregateConsumptionRows(
      [
        meta(),
        usage("charged", "2026-09-11", 10_100, {
          gross: 14,
          credits: -4,
        }),
        usage("unknown", "2026-09-11", 2, { free: null }),
      ],
      "ana-rutas-develop",
    );
    expect(
      snapshot.skus.find((item) => item.skuId === "charged"),
    ).toMatchObject({
      level: "charging",
      netCost: 10,
      remaining: 0,
      percentage: 101,
    });
    expect(
      snapshot.skus.find((item) => item.skuId === "unknown"),
    ).toMatchObject({
      level: "unpriced",
      freeLimit: null,
      remaining: null,
      percentage: null,
    });
  });

  it.each([
    [69, "healthy"],
    [70, "attention"],
    [85, "warning"],
    [95, "critical"],
    [100, "charging"],
  ])("classifies an exact %s percent boundary as %s", (units, level) => {
    const snapshot = aggregateConsumptionRows(
      [meta(), usage("boundary", "2026-09-11", units, { free: 100 })],
      "ana-rutas-develop",
    );
    expect(snapshot.skus[0]).toMatchObject({
      usage: units,
      percentage: units,
      level,
    });
  });

  it("marks a positive net cost as charging before the free threshold", () => {
    const snapshot = aggregateConsumptionRows(
      [
        meta(),
        usage("charged-early", "2026-09-11", 10, {
          free: 100,
          gross: 8,
          credits: -3,
        }),
      ],
      "ana-rutas-develop",
    );
    expect(snapshot.skus[0]).toMatchObject({
      percentage: 10,
      grossCost: 8,
      credits: -3,
      netCost: 5,
      level: "charging",
    });
    expect(snapshot.days[0]).toMatchObject({
      grossCost: 8,
      credits: -3,
      netCost: 5,
    });
    expect(snapshot.months[0]).toMatchObject({
      grossCost: 8,
      credits: -3,
      netCost: 5,
    });
    expect(snapshot).toMatchObject({ grossCost: 8, credits: -3, netCost: 5 });
  });

  it("supports an empty current period and a null provider export timestamp", () => {
    const snapshot = aggregateConsumptionRows(
      [meta({ provider_export_time: null })],
      "ana-rutas-develop",
    );
    expect(snapshot).toMatchObject({
      providerExportTime: null,
      grossCost: 0,
      credits: 0,
      netCost: 0,
      maximumPercentage: 0,
      skus: [],
      days: [],
      months: [],
    });
  });

  it.each(["current_period", "currency", "pricing_as_of_time"] as const)(
    "rejects missing required metadata field %s",
    (field) => {
      expect(() =>
        aggregateConsumptionRows([meta({ [field]: null })], "project"),
      ).toThrow("GOOGLE_CONSUMPTION_RESPONSE_INVALID");
    },
  );

  it("requires exactly one metadata row and rejects unknown row types", () => {
    expect(() => aggregateConsumptionRows([], "project")).toThrow(
      "GOOGLE_CONSUMPTION_RESPONSE_INVALID",
    );
    expect(() => aggregateConsumptionRows([meta(), meta()], "project")).toThrow(
      "GOOGLE_CONSUMPTION_RESPONSE_INVALID",
    );
    expect(() =>
      aggregateConsumptionRows(
        [meta(), { ...usage("sku", "2026-09-11", 1), row_type: "other" }],
        "project",
      ),
    ).toThrow("GOOGLE_CONSUMPTION_RESPONSE_INVALID");
  });

  it.each([
    "usage_day",
    "period_start",
    "sku_id",
    "sku_description",
    "service_description",
    "pricing_unit",
  ] as const)("rejects missing required usage field %s", (field) => {
    const incomplete = { ...usage("sku", "2026-09-11", 1), [field]: null };
    expect(() =>
      aggregateConsumptionRows([meta(), incomplete], "project"),
    ).toThrow("GOOGLE_CONSUMPTION_RESPONSE_INVALID");
  });

  it.each([
    ["free_limit", "200"],
    ["pricing_unit", "SECOND"],
    ["next_tier_price", "999"],
    ["next_tier_quantity", "999"],
  ] as const)("rejects inconsistent repeated SKU field %s", (field, value) => {
    const first = usage("sku", "2026-09-10", 1, { free: 100 });
    const second = {
      ...usage("sku", "2026-09-11", 1, { free: 100 }),
      [field]: value,
    };
    expect(() =>
      aggregateConsumptionRows([meta(), first, second], "project"),
    ).toThrow("GOOGLE_CONSUMPTION_RESPONSE_INVALID");
  });

  it("treats a zero free limit as unpriced and sorts percentage before name", () => {
    const snapshot = aggregateConsumptionRows(
      [
        meta(),
        usage("zeta", "2026-09-11", 10, { name: "Zeta", free: 100 }),
        usage("alpha", "2026-09-11", 10, { name: "Alpha", free: 100 }),
        usage("middle", "2026-09-11", 20, { name: "Middle", free: 100 }),
        usage("none", "2026-09-11", 2, { name: "None", free: 0 }),
      ],
      "project",
    );
    expect(snapshot.skus.map((sku) => sku.skuId)).toEqual([
      "middle",
      "alpha",
      "zeta",
      "none",
    ]);
    expect(snapshot.skus[3]).toMatchObject({
      percentage: null,
      remaining: 0,
      level: "unpriced",
    });
  });

  it("rejects mixed currencies and incomplete metadata", () => {
    expect(() =>
      aggregateConsumptionRows(
        [meta(), usage("sku", "2026-09-11", 1, { currency: "USD" })],
        "ana-rutas-develop",
      ),
    ).toThrow("GOOGLE_CONSUMPTION_RESPONSE_INVALID");
    expect(() =>
      aggregateConsumptionRows([meta({ pricing_as_of_time: null })], "project"),
    ).toThrow("GOOGLE_CONSUMPTION_RESPONSE_INVALID");
  });

  it("waits for an incomplete job, follows pagination and sends cost guardrails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tables: [
              {
                tableReference: {
                  tableId: "gcp_billing_export_v1_000000_000000_000000",
                },
              },
              { tableReference: { tableId: "cloud_pricing_export" } },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobComplete: false,
            jobReference: {
              projectId: "finops-project",
              jobId: "job-1",
              location: "US",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(queryResponse([meta()], { pageToken: "second-page" })),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(queryResponse([usage("fleet", "2026-09-11", 7)])),
        ),
      );
    const snapshot = await requestGoogleConsumption(config(), {
      fetch: fetcher as typeof fetch,
      token: async () => "oauth",
    });
    expect(snapshot.skus[0]).toMatchObject({ skuId: "fleet", usage: 7 });
    const queryCall = fetcher.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(queryCall[1].body));
    expect(body).toMatchObject({
      useLegacySql: false,
      parameterMode: "NAMED",
      location: "US",
      useQueryCache: true,
      maximumBytesBilled: "100000000",
    });
    expect(body.queryParameters[0].parameterValue.value).toBe(
      "ana-rutas-develop",
    );
    expect(String(fetcher.mock.calls[3][0])).toContain("pageToken=second-page");
  });
});
