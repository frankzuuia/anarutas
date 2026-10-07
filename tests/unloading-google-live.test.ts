import { expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { unloadingLearningFixture } from "./helpers/unloading-learning";
import { orderBoard } from "../src/core/orders";
import { getCustomer } from "../src/core/customers";
import {
  buildDirectFleetRequest,
  assertDirectFleetResponse,
} from "../src/core/route-google-direct";
import {
  parseGoogleOptimizationResponse,
  requestGoogleOptimization,
} from "../src/core/route-optimization-google";
import { readGoogleRoutingConfig } from "../src/core/routing-config";
import { zoneSettings } from "./helpers/zone-board";

it.runIf(Boolean(process.env.RUTAS_QA_GOOGLE_CONFIG_FILE))(
  "Google real accepts 22 learned minutes from actual collection transactions",
  async () => {
    const config = readGoogleRoutingConfig(
      JSON.parse(
        await readFile(process.env.RUTAS_QA_GOOGLE_CONFIG_FILE!, "utf8"),
      ),
    );
    const f = await unloadingLearningFixture();
    try {
      const captured = new Date(+f.now + 22 * 60000).toISOString();
      await f.collect(await f.command(0, 0, captured));
      await f.collect(await f.command(0, 1, captured));
      await f.visit(2, 22);
      expect(
        (await getCustomer(f.db.pool, f.customerId)).unloadingEstimate
          ?.effectiveMinutes,
      ).toBe(22);
      const board = await orderBoard(f.db.pool, f.planId);
      const { request, groups } = buildDirectFleetRequest(
        { ...board, plan: { ...board.plan, departure_minute: 480 } },
        zoneSettings,
        f.timezone,
      );
      expect(
        request.model.shipments.every((s) =>
          s.deliveries.every((v) => v.duration === "1320s"),
        ),
      ).toBe(true);
      const start = performance.now();
      const raw = await requestGoogleOptimization(
        config.projectId,
        config.credentials,
        request,
      );
      const response = parseGoogleOptimizationResponse(
        raw,
        groups.length,
        board.vehicles.length,
      );
      assertDirectFleetResponse(request, response);
      expect(response.skipped).toHaveLength(0);
      expect(response.metrics.totalDurationSeconds).toBeGreaterThanOrEqual(
        1320,
      );
      const service = (
        raw as {
          metrics: { aggregatedRouteMetrics: { visitDuration: string } };
        }
      ).metrics.aggregatedRouteMetrics.visitDuration;
      expect(service).toBe("1320s");
      const timings: number[] = [];
      for (let i = 0; i < 60; i++) {
        const started = performance.now();
        await getCustomer(f.db.pool, f.customerId);
        timings.push(performance.now() - started);
      }
      timings.sort((a, b) => a - b);
      const report = {
        googleCalls: 1,
        learnedMinutes: 22,
        googleVisitDuration: service,
        googleAndReadBenchmarkDurationMs: performance.now() - start,
        samples: timings.length,
        customerReadP50Ms: timings[29],
        customerReadP95Ms: timings[56],
        customerReadMaxMs: timings[59],
        metrics: response.metrics,
      };
      await mkdir("reports", { recursive: true });
      await writeFile(
        "reports/unloading-google-live.json",
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify(report));
    } finally {
      await f.close();
    }
  },
  120000,
);
