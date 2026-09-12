import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "../src/core/auth";
import {
  getGoogleConsumptionState,
  refreshGoogleConsumption,
} from "../src/core/google-consumption";
import type { GoogleConsumptionSnapshot } from "../src/core/google-consumption-contract";
import { startPostgres } from "./helpers/postgres";

function serviceAccount() {
  return Buffer.from(
    JSON.stringify({
      type: "service_account",
      project_id: "finops-project",
      client_email: "consumption@finops-project.iam.gserviceaccount.com",
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
    RUTAS_GOOGLE_CONSUMPTION_SYNC_MINUTES: "30",
  };
}

function snapshot(netCost = 0): GoogleConsumptionSnapshot {
  return {
    mapsProjectId: "ana-rutas-develop",
    currentPeriod: "2026-09-01",
    currency: "MXN",
    providerExportTime: "2026-09-11T16:00:00.000Z",
    pricingAsOfTime: "2026-09-11T00:00:00.000Z",
    grossCost: netCost,
    credits: 0,
    netCost,
    maximumPercentage: 0.4,
    skus: [
      {
        skuId: "maps-js",
        skuName: "Maps JavaScript API",
        serviceName: "Google Maps Platform",
        usage: 40,
        pricingUnit: "COUNT",
        freeLimit: 10_000,
        remaining: 9_960,
        percentage: 0.4,
        nextTierPrice: 140,
        nextTierQuantity: 1_000,
        grossCost: netCost,
        credits: 0,
        netCost,
        level: "healthy",
      },
    ],
    days: [
      {
        date: "2026-09-11",
        grossCost: netCost,
        credits: 0,
        netCost,
      },
    ],
    months: [
      {
        periodStart: "2026-09-01",
        grossCost: netCost,
        credits: 0,
        netCost,
      },
    ],
  };
}

describe("Google consumption persistence / real PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof startPostgres>>;
  let actor: string;

  beforeAll(async () => {
    db = await startPostgres();
    actor = (
      await bootstrap(db.pool, db.config, {
        token: db.config.bootstrapToken,
        name: "FinOps QA",
        login: "finops-qa",
        password: randomUUID(),
      })
    ).id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("installs schema v8 and exposes no fabricated values when unconfigured", async () => {
    expect(
      (
        await db.pool.query(
          "SELECT schema_version FROM rutas_installation WHERE singleton=true",
        )
      ).rows[0].schema_version,
    ).toBe(9);
    await expect(
      getGoogleConsumptionState(db.pool, {
        RUTAS_GOOGLE_CLOUD_PROJECT_ID: "ana-rutas-develop",
      }),
    ).resolves.toEqual({
      configured: false,
      status: "unconfigured",
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextSyncAt: null,
      errorCode: null,
      snapshot: null,
    });
  });

  it("replaces the official snapshot and audits the real provider source", async () => {
    const request = vi.fn().mockResolvedValue(snapshot());
    const state = await refreshGoogleConsumption(db.pool, actor, {
      env: environment(),
      request,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({
      configured: true,
      status: "ready",
      errorCode: null,
      snapshot: { mapsProjectId: "ana-rutas-develop", netCost: 0 },
    });
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM route_audit WHERE action='google.consumption.synced'",
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("permits only one provider request under concurrent refreshes", async () => {
    let release!: (value: GoogleConsumptionSnapshot) => void;
    const delayed = new Promise<GoogleConsumptionSnapshot>((resolve) => {
      release = resolve;
    });
    const request = vi.fn(() => delayed);
    const first = refreshGoogleConsumption(db.pool, actor, {
      env: environment(),
      request,
    });
    while (request.mock.calls.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await refreshGoogleConsumption(db.pool, actor, {
      env: environment(),
      request,
    });
    expect(second.status).toBe("syncing");
    expect(request).toHaveBeenCalledTimes(1);
    release(snapshot(12.5));
    await expect(first).resolves.toMatchObject({
      status: "ready",
      snapshot: { netCost: 12.5 },
    });
  });

  it("preserves the last successful snapshot when Google fails", async () => {
    await expect(
      refreshGoogleConsumption(db.pool, actor, {
        env: environment(),
        request: vi.fn().mockRejectedValue(new Error("secret provider detail")),
      }),
    ).rejects.toThrow("secret provider detail");
    const state = await getGoogleConsumptionState(db.pool, environment());
    expect(state).toMatchObject({
      configured: true,
      status: "stale",
      errorCode: "GOOGLE_CONSUMPTION_UNAVAILABLE",
      snapshot: { netCost: 12.5 },
    });
    expect(JSON.stringify(state)).not.toContain("secret provider detail");
  });

  it("rejects manual synchronization by an inactive or unknown actor", async () => {
    await expect(
      refreshGoogleConsumption(db.pool, randomUUID(), {
        env: environment(),
        request: vi.fn(),
      }),
    ).rejects.toThrow("UNAUTHENTICATED");
  });
});
