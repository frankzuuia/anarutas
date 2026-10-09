import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { Pool } from "pg";
import { assertInstallation, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { readOdooConfig } from "./config";
import { odooReturnConfig } from "./odoo-return-config";
import { inspectOdooReturnContract, prepareOdooReturn } from "./odoo-returns";
import {
  validateReturnRequest,
  type ReturnRequest,
} from "./odoo-return-policy";
import type { SourceShipment } from "./orders-contract";

/** Activation is explicit and source-bound. No historical incident enrollment. */
export async function activateOdooReturns(
  pool: Pool,
  instanceId: string,
  config = readOdooConfig(),
) {
  await inspectOdooReturnContract(config);
  return transaction(pool, async (sql) => {
    await assertInstallation(sql, instanceId);
    const source = (
      await sql.query(
        "SELECT fingerprint FROM route_order_source WHERE singleton FOR SHARE",
      )
    ).rows[0];
    if (source?.fingerprint !== config.fingerprint)
      throw new AppError("ODOO_SOURCE_CHANGED", 409);
    await sql.query(
      "INSERT INTO route_odoo_return_activation(source) VALUES($1) ON CONFLICT DO NOTHING",
      [config.fingerprint],
    );
  });
}

/** Caller already holds authorized execution/order/payment locks. No Odoo I/O in this transaction. */
export async function captureOdooReturn(
  sql: Sql,
  incidentId: string,
  enabled = odooReturnConfig().enabled,
) {
  if (!enabled) return;
  await sql.query(
    `INSERT INTO route_odoo_return_capture(incident_id,source)
    SELECT i.id,s.source FROM route_product_incidents i JOIN route_shipments s ON s.id=i.shipment_id
    WHERE i.id=$1 AND i.kind='return' ON CONFLICT DO NOTHING`,
    [incidentId],
  );
}

export async function enqueueOdooReturn(
  sql: Sql,
  paymentId: string,
  enabled = odooReturnConfig().enabled,
) {
  if (!enabled) return;
  const payment = (
    await sql.query(
      `SELECT p.execution_id,p.shipment_id,s.source,s.picking_id,s.order_id,s.partner_id,s.snapshot
    FROM route_order_payments p JOIN route_shipments s ON s.id=p.shipment_id WHERE p.id=$1`,
      [paymentId],
    )
  ).rows[0];
  if (!payment) return;
  const incidents = (
    await sql.query(
      `SELECT i.id,i.line_index,i.quantity::text,i.financial_move_id,i.financial_sale_line_id
    FROM route_product_incidents i JOIN route_odoo_return_capture c ON c.incident_id=i.id AND c.source=$3
    WHERE i.execution_id=$1 AND i.shipment_id=$2 AND i.kind='return'
    AND i.status<>'canceled' ORDER BY i.id`,
      [payment.execution_id, payment.shipment_id, payment.source],
    )
  ).rows;
  if (!incidents.length) return;
  const id = randomUUID(),
    snapshot = payment.snapshot as SourceShipment;
  const config = readOdooConfig();
  const request: ReturnRequest = {
    id,
    source: payment.source,
    companyId: config.companyId,
    pickingId: Number(payment.picking_id),
    orderId: Number(payment.order_id),
    partnerId: Number(payment.partner_id),
    lines: [],
  };
  let errorCode: string | null = null;
  try {
    for (const incident of incidents) {
      const line = snapshot.lines[incident.line_index];
      if (
        !line ||
        !line.uomId ||
        (incident.financial_move_id !== null &&
          Number(incident.financial_move_id) !== line.moveId) ||
        (incident.financial_sale_line_id !== null &&
          Number(incident.financial_sale_line_id) !== line.saleLineId)
      )
        throw new AppError("ODOO_RETURN_IDENTITY_INVALID", 409);
      const existing = request.lines.find(
        (item) => item.moveId === line.moveId,
      );
      if (existing) {
        existing.quantity = new Decimal(existing.quantity)
          .plus(incident.quantity)
          .toFixed();
        existing.incidentIds.push(incident.id);
      } else
        request.lines.push({
          moveId: line.moveId,
          productId: line.productId,
          uomId: line.uomId,
          quantity: incident.quantity,
          incidentIds: [incident.id],
        });
    }
    validateReturnRequest(request, config.fingerprint, config.companyId);
  } catch (error) {
    errorCode =
      error instanceof AppError ? error.code : "ODOO_RETURN_IDENTITY_INVALID";
  }
  // A captured order has one immutable job; later routes remain independently accountable.
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `ana-rutas:return-enqueue:${request.source}:${request.pickingId}:${request.orderId}`,
  ]);
  const existing = (
    await sql.query(
      "SELECT id FROM route_odoo_return_jobs WHERE execution_id=$1 AND shipment_id=$2",
      [payment.execution_id, payment.shipment_id],
    )
  ).rows[0];
  if (existing) {
    await sql.query(
      "INSERT INTO route_audit(action,entity_id,details) VALUES('odoo.return.duplicate_source',$1,$2)",
      [paymentId, JSON.stringify({ jobId: existing.id })],
    );
    return;
  }
  await sql.query(
    `INSERT INTO route_odoo_return_jobs(id,execution_id,shipment_id,payment_id,source,picking_id,order_id,request,status,last_error)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      payment.execution_id,
      payment.shipment_id,
      paymentId,
      request.source,
      request.pickingId,
      request.orderId,
      JSON.stringify(request),
      errorCode ? "review" : "queued",
      errorCode,
    ],
  );
  for (const incident of incidents)
    await sql.query(
      "INSERT INTO route_odoo_return_incidents(incident_id,job_id) VALUES($1,$2)",
      [incident.id, id],
    );
  await sql.query(
    "INSERT INTO route_audit(action,entity_id,details) VALUES('odoo.return.queued',$1,$2)",
    [
      id,
      JSON.stringify({ paymentId, incidentCount: incidents.length, errorCode }),
    ],
  );
}

export async function syncOdooReturns(
  pool: Pool,
  instanceId: string,
  config = readOdooConfig(),
  pollSeconds = odooReturnConfig().pollSeconds,
) {
  const client = await pool.connect();
  let locked = false,
    disconnected = false;
  const onError = () => {
    disconnected = true;
  };
  client.on("error", onError);
  try {
    await assertInstallation(client, instanceId);
    const source = (
      await client.query(
        "SELECT fingerprint FROM route_order_source WHERE singleton",
      )
    ).rows[0];
    if (source?.fingerprint !== config.fingerprint)
      throw new AppError("ODOO_SOURCE_CHANGED", 409);
    locked =
      (
        await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          [`ana-rutas:returns:${config.fingerprint}`],
        )
      ).rows[0].locked === true;
    if (!locked) return { status: "busy" as const };
    const job = (
      await client.query(
        `SELECT * FROM route_odoo_return_jobs WHERE source=$1
      AND status IN ('queued','sending','uncertain') AND next_attempt_at<=now() ORDER BY next_attempt_at,id LIMIT 1`,
        [config.fingerprint],
      )
    ).rows[0];
    if (!job) return { status: "idle" as const };
    const start = performance.now();
    await client.query(
      "UPDATE route_odoo_return_jobs SET status='sending',attempts=attempts+1,updated_at=clock_timestamp() WHERE id=$1",
      [job.id],
    );
    try {
      const receipt = await prepareOdooReturn(
        job.request,
        {
          started: job.creation_started,
          remoteId: job.remote_id === null ? null : Number(job.remote_id),
          beforeCreate: async () => {
            if (disconnected)
              throw new AppError("ODOO_RETURN_STORAGE_LOST", 503);
            await client.query(
              "UPDATE route_odoo_return_jobs SET creation_started=true WHERE id=$1",
              [job.id],
            );
          },
          created: async (remoteId) => {
            if (disconnected)
              throw new AppError("ODOO_RETURN_STORAGE_LOST", 503);
            await client.query(
              "UPDATE route_odoo_return_jobs SET remote_id=$2 WHERE id=$1",
              [job.id, remoteId],
            );
          },
        },
        config,
      );
      const durationMs = Math.ceil(performance.now() - start);
      await client.query("BEGIN");
      await client.query(
        "UPDATE route_odoo_return_jobs SET status='prepared',receipt=$2,last_error=NULL,last_duration_ms=$3,updated_at=clock_timestamp() WHERE id=$1",
        [job.id, JSON.stringify(receipt), durationMs],
      );
      await client.query(
        "INSERT INTO route_odoo_return_attempts(job_id,status,duration_ms) VALUES($1,'prepared',$2)",
        [job.id, durationMs],
      );
      await client.query("COMMIT");
      return { status: "prepared" as const, jobId: job.id, durationMs };
    } catch (error) {
      if (disconnected) throw error;
      await client.query("ROLLBACK");
      const code = error instanceof AppError ? error.code : "ODOO_UNAVAILABLE";
      const current = (
        await client.query(
          "SELECT creation_started FROM route_odoo_return_jobs WHERE id=$1",
          [job.id],
        )
      ).rows[0];
      const technical = [
        "ODOO_UNAVAILABLE",
        "ODOO_INVALID_RESPONSE",
        "ODOO_RATE_LIMITED",
        "ODOO_RETURN_OUTCOME_UNKNOWN",
        "ODOO_RETURN_STORAGE_LOST",
      ].includes(code);
      const status = technical
        ? current.creation_started
          ? "uncertain"
          : "queued"
        : "review";
      const retry = Math.min(
        3600,
        pollSeconds * 2 ** Math.min(job.attempts, 8),
      );
      const durationMs = Math.ceil(performance.now() - start);
      await client.query("BEGIN");
      await client.query(
        `UPDATE route_odoo_return_jobs SET status=$2,last_error=$3,last_duration_ms=$4,
        next_attempt_at=now()+make_interval(secs=>$5),updated_at=clock_timestamp() WHERE id=$1`,
        [job.id, status, code, durationMs, retry],
      );
      await client.query(
        "INSERT INTO route_odoo_return_attempts(job_id,status,error_code,duration_ms) VALUES($1,$2,$3,$4)",
        [job.id, status, code, durationMs],
      );
      await client.query("COMMIT");
      return { status: "failed" as const, jobId: job.id, code, durationMs };
    }
  } finally {
    if (locked && !disconnected)
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          `ana-rutas:returns:${config.fingerprint}`,
        ])
        .catch(() => {
          disconnected = true;
        });
    client.removeListener("error", onError);
    client.release(disconnected);
  }
}
