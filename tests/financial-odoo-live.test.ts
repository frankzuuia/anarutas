import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readOdooConfig } from "../src/core/config";
import { readFinancialSources } from "../src/core/odoo";
import { startPostgres } from "./helpers/postgres";
import { bootstrap } from "../src/core/auth";
import { createPlan } from "../src/core/plans";
import { persistImportPage } from "../src/core/orders";
import { syncFinancialSources } from "../src/core/financial-sync";
import { readShipmentFinancials } from "../src/core/financial-store";
import { financialSyncConfig } from "../src/core/financial-config";
import type { FinancialTarget } from "../src/core/financial-contract";

it.skipIf(!process.env.RUTAS_TEST_FINANCIAL_TARGETS)(
  "reads real Odoo by identities, imports into real PostgreSQL, syncs automatically and preserves authoritative values",
  async () => {
    const config = readOdooConfig();
    const targets: FinancialTarget[] = JSON.parse(
      process.env.RUTAS_TEST_FINANCIAL_TARGETS!,
    ).map((value: Omit<FinancialTarget, "source">) => ({
      ...value,
      source: config.fingerprint,
    }));
    const snapshots = await readFinancialSources(targets, config);
    expect(snapshots).toHaveLength(targets.length);
    expect(snapshots.some((snapshot) => snapshot.status === "ready")).toBe(
      true,
    );
    const expected: Record<
      string,
      { status: string; total: string; adjustment: string }
    > = JSON.parse(process.env.RUTAS_TEST_FINANCIAL_EXPECTED ?? "{}");
    for (const snapshot of snapshots) {
      expect(snapshot.target.source).toBe(config.fingerprint);
      expect(snapshot.companyId).toBe(config.companyId);
      expect(
        snapshot.lines.every(
          (line) => line.id > 0 && line.saleLineId > 0 && line.uomId > 0,
        ),
      ).toBe(true);
      const check = expected[String(snapshot.target.orderId)];
      if (check)
        expect(snapshot).toMatchObject({
          status: check.status,
          order: { amounts: { total: check.total } },
          roundingAdjustment: check.adjustment,
        });
      if (snapshot.status !== "ready")
        expect(snapshot.shipmentAmounts).toBeNull();
    }
    const db = await startPostgres();
    try {
      const actor = (
        await bootstrap(db.pool, db.config, {
          token: db.config.bootstrapToken,
          name: "Financial read-only Odoo QA",
          login: randomUUID(),
          password: randomUUID(),
        })
      ).id;
      const plan = await createPlan(db.pool, actor, {
        date: "2026-09-30",
        label: "Financial integration QA",
      });
      await persistImportPage(db.pool, actor, plan.id, {
        fingerprint: config.fingerprint,
        shipments: snapshots.map((snapshot) => ({
          pickingId: snapshot.target.pickingId,
          pickingName: snapshot.picking.name,
          orderId: snapshot.target.orderId,
          orderName: snapshot.order.name,
          partnerId: snapshot.target.partnerId,
          customerName: "QA read-only",
          address: "",
          validatedAt: snapshot.picking.validatedAt,
          promisedAt: null,
          backorderId: null,
          lines: snapshot.lines.map((line) => ({
            moveId: line.id,
            saleLineId: line.saleLineId,
            uomId: line.uomId,
            productId: line.productId,
            name: snapshot.saleLines.find(
              (saleLine) => saleLine.id === line.saleLineId,
            )!.name,
            quantity: Number(
              snapshot.status === "ready" ? line.quantity : line.demand,
            ),
            unit: line.uom,
          })),
        })),
        inspected: snapshots.length,
        excluded: 0,
        nextCursor: 0,
        ceiling: 0,
        hasMore: false,
      });
      const operational = (
        await db.pool.query(
          "SELECT id,snapshot FROM route_shipments ORDER BY id",
        )
      ).rows;
      const result = await syncFinancialSources(
        db.pool,
        db.config.instanceId,
        config,
        financialSyncConfig({}),
      );
      expect(result).toMatchObject({
        status: "synced",
        inspected: snapshots.length,
        changed: snapshots.length,
      });
      for (const row of operational) {
        const persisted = await readShipmentFinancials(db.pool, actor, row.id);
        expect(persisted.snapshot).toEqual(
          snapshots.find(
            (snapshot) => snapshot.target.orderId === row.snapshot.orderId,
          ),
        );
        expect(persisted.revision).toBe(1);
      }
      expect(
        (
          await db.pool.query(
            "SELECT id,snapshot FROM route_shipments ORDER BY id",
          )
        ).rows,
      ).toEqual(operational);
      await db.pool.query(
        "UPDATE route_financial_targets SET next_attempt_at=now()",
      );
      const interrupted = syncFinancialSources(
        db.pool,
        db.config.instanceId,
        config,
        financialSyncConfig({}),
      ).then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
      let terminated = false;
      const deadline = Date.now() + 5000;
      while (!terminated && Date.now() < deadline) {
        const active = await db.pool
          .query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND application_name='ana-rutas' AND pid<>pg_backend_pid() AND state='idle'
          AND query LIKE '%FROM route_financial_targets t%'`);
        if (active.rows.length) {
          // This connection belongs exclusively to this temporary QA database.
          await db.pool.query("SELECT pg_terminate_backend($1)", [
            active.rows[0].pid,
          ]);
          terminated = true;
        } else await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const lost = await interrupted;
      expect(terminated).toBe(true);
      expect(lost.error).toMatchObject({
        code: "FINANCIAL_SYNC_CONNECTION_LOST",
      });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM route_financial_revisions",
          )
        ).rows[0].count,
      ).toBe(snapshots.length);
      const recovered = await syncFinancialSources(
        db.pool,
        db.config.instanceId,
        config,
        financialSyncConfig({}),
      );
      expect(recovered).toMatchObject({
        status: "synced",
        changed: 0,
        inspected: snapshots.length,
      });
      console.info(
        JSON.stringify({
          event: "qa.financial.odoo",
          ...result,
          connectionLossRecovered: true,
          sources: snapshots.map((snapshot) => ({
            pickingId: snapshot.target.pickingId,
            orderId: snapshot.target.orderId,
            status: snapshot.status,
            total: snapshot.order.amounts.total,
            currency: snapshot.currency.name,
            adjustment: snapshot.roundingAdjustment,
            lines: snapshot.lines.length,
          })),
        }),
      );
    } finally {
      await db.close();
    }
  },
  240_000,
);
