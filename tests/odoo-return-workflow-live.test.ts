import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { executionFixture } from "./helpers/driver-execution";
import { readOdooConfig } from "../src/core/config";
import { odooRpc } from "../src/core/odoo-rpc";
import {
  readFinancialSources,
  readFulfilledByOrderNames,
} from "../src/core/odoo";
import { persistFinancialSnapshot } from "../src/core/financial-store";
import { transaction } from "../src/core/database";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { reportProductIncidentWithEvidence } from "../src/core/product-incidents-evidence";
import { readMobileFinanceDetail } from "../src/core/finance-read";
import { confirmOrderPayment } from "../src/core/payments";
import {
  activateOdooReturns,
  syncOdooReturns,
} from "../src/core/odoo-return-store";
import { readIncidentBoard } from "../src/core/incident-board";

it.skipIf(!process.env.RUTAS_TEST_RETURN_WORKFLOW_PICKING)(
  "real develop: imported delivery, signed driver, photo, atomic collection, concurrent workers and frozen money",
  async () => {
    const config = readOdooConfig();
    if (
      new URL(config.url).hostname !== "developfive.odoo.com" ||
      config.database !== "developfive"
    )
      throw Error("DEVELOP_SCOPE_MISMATCH");
    const originalFlag = process.env.RUTAS_ODOO_RETURNS_ENABLED;
    process.env.RUTAS_ODOO_RETURNS_ENABLED = "true";
    let f: Awaited<ReturnType<typeof executionFixture>> | undefined;
    try {
      const uid = await odooRpc(config, "common", "authenticate", [
        config.database,
        config.username,
        config.credential,
        {},
      ]);
      const picking = (
        (await odooRpc(config, "object", "execute_kw", [
          config.database,
          uid,
          config.credential,
          "stock.picking",
          "read",
          [[Number(process.env.RUTAS_TEST_RETURN_WORKFLOW_PICKING)]],
          {
            fields: ["sale_id"],
            context: { allowed_company_ids: [config.companyId] },
          },
        ])) as { sale_id: [number, string] }[]
      )[0];
      const imported = await readFulfilledByOrderNames(
        [picking.sale_id[1]],
        config,
      );
      const shipment = imported.shipments.find(
        (item) =>
          item.pickingId ===
          Number(process.env.RUTAS_TEST_RETURN_WORKFLOW_PICKING),
      )!;
      expect(shipment).toBeTruthy();
      const target = {
        source: config.fingerprint,
        pickingId: shipment.pickingId,
        orderId: shipment.orderId,
        partnerId: shipment.partnerId,
      };
      const financial = (await readFinancialSources([target], config))[0];
      expect(financial.status).toBe("ready");
      f = await executionFixture({
        sourceFingerprint: config.fingerprint,
        sourceShipments: [shipment],
        now: new Date(),
      });
      await transaction(f.db.pool, (sql) =>
        persistFinancialSnapshot(sql, financial, 60, 1),
      );
      await f.start();
      await activateOdooReturns(f.db.pool, f.db.config.instanceId, config);
      const state = () =>
        readDriverExecution(
          f!.db.pool,
          f!.members[0].driverId,
          f!.planId,
          f!.timezone,
        );
      const identity = async () => {
        const route = await state(),
          stop = route.stops[0];
        return {
          commandId: randomUUID(),
          executionId: route.id,
          publicationRevision: route.publicationRevision,
          executionRevision: route.revision,
          policyVersion: route.policy.version,
          stopVersion: stop.version,
          visitSequence: stop.visitSequence,
          orderVersion: stop.orderStates[0].version,
        };
      };
      const route = await state(),
        stop = route.stops[0],
        shipmentId = stop.shipmentIds[0];
      await executeStopCommand(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stop.id,
        "arrival",
        {
          ...(await identity()),
          sample: {
            latitude: 20.64,
            longitude: -103.4,
            accuracyMeters: 5,
            ageMilliseconds: 0,
            capturedAt: f.now.toISOString(),
            mock: false,
          },
        },
        f.timezone,
        f.now,
      );
      const chosen = shipment.lines.slice(0, 2);
      expect(chosen).toHaveLength(2);
      const bytes = await sharp({
        create: { width: 24, height: 24, channels: 3, background: "#229933" },
      })
        .jpeg()
        .toBuffer();
      const incidents: string[] = [];
      for (const [lineIndex, line] of chosen.entries()) {
        const incident = await reportProductIncidentWithEvidence(
          f.db.pool,
          f.members[0].authorization,
          f.planId,
          stop.id,
          shipmentId,
          {
            ...(await identity()),
            kind: "return",
            formVersion: 3,
            lineIndex,
            quantity: "0.25",
            comments: ["damaged_product"],
            financialContractVersion: 1,
            financial: {
              revision: 1,
              moveId: line.moveId,
              saleLineId: line.saleLineId,
            },
          },
          f.timezone,
          bytes,
          "image/jpeg",
          f.photoRoot,
        );
        incidents.push(incident.incidentId!);
      }
      const detail = await readMobileFinanceDetail(
        f.db.pool,
        f.members[0].authorization,
        route.id,
      );
      const expected = detail.orders[0].financial!.totals!.net;
      const command = {
        commandId: randomUUID(),
        shipmentId,
        method: "cash",
        tendered: expected,
        change: "0",
        note: "",
        basis: detail.orders[0].basis,
        captureVersion: 2,
        attention: {
          ...(await identity()),
          planId: f.planId,
          stopId: stop.id,
          productIncidentsAcknowledged: true,
        },
      };
      const paid = await confirmOrderPayment(
        f.db.pool,
        f.members[0].authorization,
        route.id,
        command,
        f.timezone,
      );
      const frozen = (
        await f.db.pool.query(
          "SELECT expected,snapshot FROM route_order_payments WHERE id=$1",
          [paid.id],
        )
      ).rows[0];
      const started = performance.now();
      const results = await Promise.all([
        syncOdooReturns(f.db.pool, f.db.config.instanceId, config),
        syncOdooReturns(f.db.pool, f.db.config.instanceId, config),
      ]);
      expect(results.filter((item) => item.status === "prepared")).toHaveLength(
        1,
      );
      expect(
        results.some(
          (item) => item.status === "busy" || item.status === "idle",
        ),
      ).toBe(true);
      const job = (
        await f.db.pool.query("SELECT * FROM route_odoo_return_jobs")
      ).rows[0];
      expect(job.status).toBe("prepared");
      expect(job.receipt.lines).toHaveLength(chosen.length);
      for (const line of chosen)
        expect(job.receipt.lines).toContainEqual(
          expect.objectContaining({
            moveId: line.moveId,
            productId: line.productId,
            uomId: line.uomId,
            quantity: "0.25",
          }),
        );
      expect(job.receipt.state).not.toBe("done");
      expect(
        (await syncOdooReturns(f.db.pool, f.db.config.instanceId, config))
          .status,
      ).toBe("idle");
      expect(
        (
          await confirmOrderPayment(
            f.db.pool,
            f.members[0].authorization,
            route.id,
            command,
            f.timezone,
          )
        ).duplicate,
      ).toBe(true);
      const after = (await readFinancialSources([target], config))[0];
      expect(after.reasons).toContain("RETURNED_STOCK");
      await transaction(f.db.pool, (sql) =>
        persistFinancialSnapshot(sql, after, 60, 1),
      );
      expect(
        (
          await f.db.pool.query(
            "SELECT expected,snapshot FROM route_order_payments WHERE id=$1",
            [paid.id],
          )
        ).rows[0],
      ).toEqual(frozen);
      const collected = await readMobileFinanceDetail(
        f.db.pool,
        f.members[0].authorization,
        route.id,
      );
      expect(collected.orders[0].payment!.expected).toBe(expected);
      expect(collected.orders[0].payment!.snapshot.financial!.totals!.net).toBe(
        expected,
      );
      const board = await readIncidentBoard(
        f.db.pool,
        f.actor,
        new URLSearchParams(),
        f.timezone,
      );
      expect(
        board.rows.find((item) => item.id === incidents[0])?.odooReturn,
      ).toMatchObject({ status: "prepared", reference: job.receipt.name });
      await expect(
        syncOdooReturns(f.db.pool, f.db.config.instanceId, {
          ...config,
          fingerprint: "another-installation",
        }),
      ).rejects.toMatchObject({ code: "ODOO_SOURCE_CHANGED" });
      await writeFile(
        ".local/odoo-return-workflow-evidence.json",
        JSON.stringify(
          {
            nativeReceipt: job.receipt,
            picking: shipment.pickingId,
            order: shipment.orderName,
            concurrentWorkers: results.map((item) => item.status),
            immutableCollection: true,
            adminStatus: "prepared",
            durationMs: Math.ceil(performance.now() - started),
            validation: "manual, not executed",
          },
          null,
          2,
        ),
      );
    } finally {
      await f?.close();
      if (originalFlag === undefined)
        delete process.env.RUTAS_ODOO_RETURNS_ENABLED;
      else process.env.RUTAS_ODOO_RETURNS_ENABLED = originalFlag;
    }
  },
  120000,
);
