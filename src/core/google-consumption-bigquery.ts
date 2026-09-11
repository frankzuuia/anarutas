import { GoogleAuth } from "google-auth-library";
import { AppError } from "./errors";
import type { GoogleConsumptionConfig } from "./google-consumption-config";
import type {
  GoogleConsumptionDay,
  GoogleConsumptionLevel,
  GoogleConsumptionMonth,
  GoogleConsumptionSnapshot,
  GoogleConsumptionSku,
} from "./google-consumption-contract";

type Dependencies = {
  fetch?: typeof fetch;
  token?: () => Promise<string>;
};

type BigQueryField = { name?: unknown };
type BigQueryResponse = {
  jobComplete?: unknown;
  jobReference?: {
    projectId?: unknown;
    jobId?: unknown;
    location?: unknown;
  };
  schema?: { fields?: BigQueryField[] };
  rows?: { f?: { v?: unknown }[] }[];
  pageToken?: unknown;
  errors?: unknown;
};

type WireRow = {
  row_type: string;
  current_period: string;
  usage_day: string | null;
  period_start: string | null;
  sku_id: string | null;
  sku_description: string | null;
  service_description: string | null;
  units: string | null;
  gross_cost: string | null;
  credits: string | null;
  currency: string | null;
  provider_export_time: string | null;
  pricing_as_of_time: string | null;
  pricing_unit: string | null;
  free_limit: string | null;
  next_tier_price: string | null;
  next_tier_quantity: string | null;
};

const expectedFields = [
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

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  return value as Record<string, unknown>;
}

async function accessToken(config: GoogleConsumptionConfig) {
  try {
    const token = await new GoogleAuth({
      credentials: config.credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getAccessToken();
    if (!token) throw new Error();
    return token;
  } catch {
    throw new AppError("GOOGLE_CONSUMPTION_DENIED", 503);
  }
}

async function limitedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("GOOGLE_CONSUMPTION_UNAVAILABLE", 503);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > 5 * 1024 * 1024) {
      await reader.cancel();
      throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
    }
    chunks.push(chunk.value);
  }
  try {
    return asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  }
}

function providerError(status: number) {
  if (status === 401 || status === 403)
    return new AppError("GOOGLE_CONSUMPTION_DENIED", 503);
  if (status === 404)
    return new AppError("GOOGLE_CONSUMPTION_EXPORT_MISSING", 503);
  if (status === 429) return new AppError("GOOGLE_CONSUMPTION_QUOTA", 503);
  return new AppError("GOOGLE_CONSUMPTION_UNAVAILABLE", 503);
}

async function googleFetch(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new AppError("GOOGLE_CONSUMPTION_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw providerError(response.status);
  }
  return limitedJson(response);
}

function tableId(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 1024 ||
    ![...value].every((character) =>
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".includes(
        character,
      ),
    )
  )
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  return value;
}

export async function discoverBillingTables(
  config: GoogleConsumptionConfig,
  dependencies: Dependencies = {},
) {
  const token = await (dependencies.token || (() => accessToken(config)))();
  const fetcher = dependencies.fetch || fetch;
  const ids: string[] = [];
  let pageToken: string | null = null;
  do {
    const query = new URLSearchParams({ maxResults: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const value = await googleFetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(config.queryProjectId)}/datasets/${encodeURIComponent(config.datasetId)}/tables?${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fetcher,
    );
    const tables = value.tables;
    if (tables !== undefined && !Array.isArray(tables))
      throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
    for (const item of tables || []) {
      const reference = asRecord(asRecord(item).tableReference);
      ids.push(tableId(reference.tableId));
      if (ids.length > 5000)
        throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
    }
    pageToken =
      typeof value.nextPageToken === "string" && value.nextPageToken.length
        ? value.nextPageToken
        : null;
  } while (pageToken);
  const standard = ids.filter((id) => id.startsWith("gcp_billing_export_v1_"));
  if (standard.length !== 1 || !ids.includes("cloud_pricing_export"))
    throw new AppError("GOOGLE_CONSUMPTION_EXPORT_MISSING", 503);
  return {
    standard: standard[0],
    pricing: "cloud_pricing_export",
    token,
  };
}

function qualified(config: GoogleConsumptionConfig, table: string) {
  return `\`${config.queryProjectId}.${config.datasetId}.${tableId(table)}\``;
}

export function consumptionQuery(
  config: GoogleConsumptionConfig,
  standardTable: string,
  pricingTable: string,
) {
  const standard = qualified(config, standardTable);
  const pricing = qualified(config, pricingTable);
  return `
WITH latest_prices AS (
  SELECT *
  FROM ${pricing}
  WHERE business_entity_name = 'Maps'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY sku.id ORDER BY export_time DESC) = 1
), price_summary AS (
  SELECT
    p.sku.id AS sku_id,
    ANY_VALUE(p.sku.description) AS sku_description,
    ANY_VALUE(p.service.description) AS service_description,
    ANY_VALUE(p.pricing_unit) AS pricing_unit,
    ANY_VALUE(p.account_currency_code) AS currency,
    MAX(p.pricing_as_of_time) AS pricing_as_of_time,
    MIN(IF(tier.account_currency_amount > 0, tier.start_usage_amount, NULL)) AS free_limit,
    ARRAY_AGG(IF(tier.account_currency_amount > 0, tier.account_currency_amount, NULL) IGNORE NULLS ORDER BY tier.start_usage_amount LIMIT 1)[SAFE_OFFSET(0)] AS next_tier_price,
    ARRAY_AGG(IF(tier.account_currency_amount > 0, tier.pricing_unit_quantity, NULL) IGNORE NULLS ORDER BY tier.start_usage_amount LIMIT 1)[SAFE_OFFSET(0)] AS next_tier_quantity
  FROM latest_prices p
  CROSS JOIN UNNEST(p.list_price.tiered_rates) AS tier
  GROUP BY p.sku.id
), usage_rows AS (
  SELECT
    FORMAT_DATE('%Y-%m-%d', DATE(b.usage_start_time, 'US/Pacific')) AS usage_day,
    FORMAT_DATE('%Y-%m-01', DATE_TRUNC(DATE(b.usage_start_time, 'US/Pacific'), MONTH)) AS period_start,
    b.sku.id AS sku_id,
    ANY_VALUE(b.sku.description) AS sku_description,
    ANY_VALUE(b.service.description) AS service_description,
    SUM(CAST(b.usage.amount_in_pricing_units AS BIGNUMERIC)) AS units,
    SUM(CAST(b.cost AS BIGNUMERIC)) AS gross_cost,
    SUM(IFNULL((SELECT SUM(CAST(credit.amount AS BIGNUMERIC)) FROM UNNEST(b.credits) AS credit), 0)) AS credits,
    ANY_VALUE(b.currency) AS currency,
    MAX(b.export_time) AS provider_export_time
  FROM ${standard} b
  INNER JOIN latest_prices p ON p.sku.id = b.sku.id
  WHERE b.project.id = @mapsProjectId
    AND b.export_time >= TIMESTAMP(
      DATE_SUB(DATE_TRUNC(CURRENT_DATE('US/Pacific'), MONTH), INTERVAL 2 MONTH),
      'US/Pacific'
    )
    AND b.usage_start_time >= TIMESTAMP(
      DATE_SUB(DATE_TRUNC(CURRENT_DATE('US/Pacific'), MONTH), INTERVAL 2 MONTH),
      'US/Pacific'
    )
  GROUP BY usage_day, period_start, b.sku.id
), metadata AS (
  SELECT
    FORMAT_DATE('%Y-%m-01', DATE_TRUNC(CURRENT_DATE('US/Pacific'), MONTH)) AS current_period,
    (SELECT MAX(provider_export_time) FROM usage_rows) AS provider_export_time,
    (SELECT MAX(pricing_as_of_time) FROM price_summary) AS pricing_as_of_time,
    (SELECT ARRAY_AGG(currency ORDER BY pricing_as_of_time DESC LIMIT 1)[SAFE_OFFSET(0)] FROM price_summary) AS currency
)
SELECT
  'meta' AS row_type,
  metadata.current_period,
  CAST(NULL AS STRING) AS usage_day,
  CAST(NULL AS STRING) AS period_start,
  CAST(NULL AS STRING) AS sku_id,
  CAST(NULL AS STRING) AS sku_description,
  CAST(NULL AS STRING) AS service_description,
  CAST(NULL AS BIGNUMERIC) AS units,
  CAST(NULL AS BIGNUMERIC) AS gross_cost,
  CAST(NULL AS BIGNUMERIC) AS credits,
  metadata.currency,
  metadata.provider_export_time,
  metadata.pricing_as_of_time,
  CAST(NULL AS STRING) AS pricing_unit,
  CAST(NULL AS BIGNUMERIC) AS free_limit,
  CAST(NULL AS BIGNUMERIC) AS next_tier_price,
  CAST(NULL AS BIGNUMERIC) AS next_tier_quantity
FROM metadata
UNION ALL
SELECT
  'usage' AS row_type,
  metadata.current_period,
  u.usage_day,
  u.period_start,
  u.sku_id,
  COALESCE(p.sku_description, u.sku_description),
  COALESCE(p.service_description, u.service_description),
  u.units,
  u.gross_cost,
  u.credits,
  u.currency,
  u.provider_export_time,
  p.pricing_as_of_time,
  p.pricing_unit,
  p.free_limit,
  p.next_tier_price,
  p.next_tier_quantity
FROM usage_rows u
INNER JOIN price_summary p USING (sku_id)
CROSS JOIN metadata
ORDER BY row_type, period_start, usage_day, sku_id`;
}

function parseResultRows(value: BigQueryResponse) {
  if (value.errors !== undefined)
    throw new AppError("GOOGLE_CONSUMPTION_UNAVAILABLE", 503);
  const fields = value.schema?.fields;
  if (!Array.isArray(fields))
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  const names = fields.map((field) => field.name);
  if (
    names.length !== expectedFields.length ||
    names.some((name, index) => name !== expectedFields[index])
  )
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  if (value.rows !== undefined && !Array.isArray(value.rows))
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  return (value.rows || []).map((row) => {
    if (!Array.isArray(row.f) || row.f.length !== expectedFields.length)
      throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
    return Object.fromEntries(
      expectedFields.map((field, index) => [
        field,
        row.f![index]?.v == null ? null : String(row.f![index].v),
      ]),
    ) as WireRow;
  });
}

function response(value: Record<string, unknown>) {
  return value as BigQueryResponse;
}

async function queryPages(
  config: GoogleConsumptionConfig,
  token: string,
  query: string,
  fetcher: typeof fetch,
) {
  let value = response(
    await googleFetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(config.queryProjectId)}/queries`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          useLegacySql: false,
          parameterMode: "NAMED",
          queryParameters: [
            {
              name: "mapsProjectId",
              parameterType: { type: "STRING" },
              parameterValue: { value: config.mapsProjectId },
            },
          ],
          location: config.location,
          maxResults: 5000,
          timeoutMs: 30_000,
          useQueryCache: true,
          maximumBytesBilled: String(config.maximumBytesBilled),
        }),
      },
      fetcher,
    ),
  );
  const reference = value.jobReference;
  if (
    !reference ||
    typeof reference.projectId !== "string" ||
    typeof reference.jobId !== "string" ||
    typeof reference.location !== "string"
  )
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  for (let attempt = 0; value.jobComplete !== true && attempt < 6; attempt++) {
    const parameters = new URLSearchParams({
      location: reference.location,
      maxResults: "5000",
      timeoutMs: "10000",
    });
    value = response(
      await googleFetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(reference.projectId)}/queries/${encodeURIComponent(reference.jobId)}?${parameters}`,
        { headers: { Authorization: `Bearer ${token}` } },
        fetcher,
      ),
    );
  }
  if (value.jobComplete !== true)
    throw new AppError("GOOGLE_CONSUMPTION_UNAVAILABLE", 503);
  const rows = parseResultRows(value);
  let pageToken =
    typeof value.pageToken === "string" && value.pageToken.length
      ? value.pageToken
      : null;
  while (pageToken) {
    const parameters = new URLSearchParams({
      location: reference.location,
      maxResults: "5000",
      pageToken,
    });
    const page = response(
      await googleFetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(reference.projectId)}/queries/${encodeURIComponent(reference.jobId)}?${parameters}`,
        { headers: { Authorization: `Bearer ${token}` } },
        fetcher,
      ),
    );
    rows.push(...parseResultRows(page));
    if (rows.length > 5000)
      throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
    pageToken =
      typeof page.pageToken === "string" && page.pageToken.length
        ? page.pageToken
        : null;
  }
  return rows;
}

function number(value: string | null, nullable = false) {
  if (value === null && nullable) return null;
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed))
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  return parsed;
}

function instant(value: string | null, nullable = false) {
  if (value === null && nullable) return null;
  if (value === null || !Number.isFinite(Date.parse(value)))
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  return new Date(value).toISOString();
}

function level(
  percentage: number | null,
  netCost: number,
): GoogleConsumptionLevel {
  if (netCost > 0 || (percentage !== null && percentage >= 100))
    return "charging";
  if (percentage === null) return "unpriced";
  if (percentage >= 95) return "critical";
  if (percentage >= 85) return "warning";
  if (percentage >= 70) return "attention";
  return "healthy";
}

function addCost<
  T extends { grossCost: number; credits: number; netCost: number },
>(target: T, gross: number, credits: number) {
  target.grossCost += gross;
  target.credits += credits;
  target.netCost += gross + credits;
}

export function aggregateConsumptionRows(
  rows: WireRow[],
  mapsProjectId: string,
): GoogleConsumptionSnapshot {
  const metadata = rows.filter((row) => row.row_type === "meta");
  if (metadata.length !== 1)
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  const meta = metadata[0];
  if (!meta.current_period || !meta.currency || !meta.pricing_as_of_time)
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  const pricingAsOfTime = instant(meta.pricing_as_of_time) as string;
  const providerExportTime = instant(meta.provider_export_time, true);
  const usage = rows.filter((row) => row.row_type === "usage");
  if (rows.length !== usage.length + 1)
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  const currencies = new Set(
    usage
      .map((row) => row.currency)
      .filter((value): value is string => !!value),
  );
  currencies.add(meta.currency);
  if (currencies.size !== 1)
    throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
  const skuMap = new Map<string, GoogleConsumptionSku>();
  const dayMap = new Map<string, GoogleConsumptionDay>();
  const monthMap = new Map<string, GoogleConsumptionMonth>();
  for (const row of usage) {
    if (
      !row.usage_day ||
      !row.period_start ||
      !row.sku_id ||
      !row.sku_description ||
      !row.service_description ||
      !row.pricing_unit
    )
      throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
    const units = number(row.units) as number;
    const gross = number(row.gross_cost) as number;
    const credits = number(row.credits) as number;
    const freeLimit = number(row.free_limit, true);
    const nextTierPrice = number(row.next_tier_price, true);
    const nextTierQuantity = number(row.next_tier_quantity, true);
    const day = dayMap.get(row.usage_day) || {
      date: row.usage_day,
      grossCost: 0,
      credits: 0,
      netCost: 0,
    };
    addCost(day, gross, credits);
    dayMap.set(row.usage_day, day);
    const month = monthMap.get(row.period_start) || {
      periodStart: row.period_start,
      grossCost: 0,
      credits: 0,
      netCost: 0,
    };
    addCost(month, gross, credits);
    monthMap.set(row.period_start, month);
    if (row.period_start !== meta.current_period) continue;
    const sku = skuMap.get(row.sku_id) || {
      skuId: row.sku_id,
      skuName: row.sku_description,
      serviceName: row.service_description,
      usage: 0,
      pricingUnit: row.pricing_unit,
      freeLimit,
      remaining: null,
      percentage: null,
      nextTierPrice,
      nextTierQuantity,
      grossCost: 0,
      credits: 0,
      netCost: 0,
      level: "unpriced" as const,
    };
    if (
      sku.freeLimit !== freeLimit ||
      sku.pricingUnit !== row.pricing_unit ||
      sku.nextTierPrice !== nextTierPrice ||
      sku.nextTierQuantity !== nextTierQuantity
    )
      throw new AppError("GOOGLE_CONSUMPTION_RESPONSE_INVALID", 503);
    sku.usage += units;
    addCost(sku, gross, credits);
    skuMap.set(row.sku_id, sku);
  }
  const skus = [...skuMap.values()]
    .map((sku) => {
      const percentage =
        sku.freeLimit !== null && sku.freeLimit > 0
          ? (sku.usage / sku.freeLimit) * 100
          : null;
      return {
        ...sku,
        remaining:
          sku.freeLimit === null
            ? null
            : Math.max(0, sku.freeLimit - sku.usage),
        percentage,
        level: level(percentage, sku.netCost),
      };
    })
    .sort((left, right) =>
      right.percentage === left.percentage
        ? left.skuName.localeCompare(right.skuName)
        : (right.percentage ?? -1) - (left.percentage ?? -1),
    );
  const current = monthMap.get(meta.current_period) || {
    periodStart: meta.current_period,
    grossCost: 0,
    credits: 0,
    netCost: 0,
  };
  return {
    mapsProjectId,
    currentPeriod: meta.current_period,
    currency: meta.currency,
    providerExportTime,
    pricingAsOfTime,
    grossCost: current.grossCost,
    credits: current.credits,
    netCost: current.netCost,
    maximumPercentage: skus.length
      ? Math.max(...skus.map((sku) => sku.percentage ?? 0))
      : 0,
    skus,
    days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    months: [...monthMap.values()].sort((a, b) =>
      a.periodStart.localeCompare(b.periodStart),
    ),
  };
}

export async function requestGoogleConsumption(
  config: GoogleConsumptionConfig,
  dependencies: Dependencies = {},
) {
  const tables = await discoverBillingTables(config, dependencies);
  const rows = await queryPages(
    config,
    tables.token,
    consumptionQuery(config, tables.standard, tables.pricing),
    dependencies.fetch || fetch,
  );
  return aggregateConsumptionRows(rows, config.mapsProjectId);
}
