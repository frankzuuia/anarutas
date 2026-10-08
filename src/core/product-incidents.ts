import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";
import { serviceNote } from "./driver-service-policy";
import {
  lockServiceContext,
  serviceIdentity,
  serviceSnapshot,
} from "./driver-service-context";
import { saveDriverCommandReceipt } from "./driver-command-receipts";
import {
  incidentQuantity,
  incidentClassificationInput,
  productIncidentClassification,
  productIncidentInput,
  requireProductEvidence,
  reportableProductIncidentKinds,
  type ProductIncidentKind,
  type WarehouseReason,
} from "./product-incidents-policy";
import { todayInTimezone } from "./local-date";
import { incidentFilters } from "./driver-incidents";
import type { storeIncidentEvidence } from "./driver-incident-evidence";
import { productPhotoCount } from "./product-incident-form";
import {
  assertUnpricedIncidentSource,
  lockIncidentFinancialSource,
} from "./driver-financial-store";

export type ProductIncident = {
  id: string;
  executionId: string;
  shipmentId: string;
  lineIndex: number | null;
  kind: ProductIncidentKind;
  product: string;
  quantity: string;
  unit: string;
  note: string | null;
  originalNote?: string | null;
  adminComment?: string | null;
  orderName: string;
  occurredAt: string;
  date: string;
  timezone: string;
  driverId: string;
  snapshot: ReturnType<typeof serviceSnapshot>;
  status: "pending" | "resolved" | "canceled";
  version: number;
  department: string | null;
  concept: string | null;
  resolutionNote: string | null;
  warehouseReason: WarehouseReason | null;
  evidenceId: string | null;
  evidenceIds?: string[];
};
export type ProductIncidentReport = {
  rows: ProductIncident[];
  nextCursor: string | null;
  pending: number;
};

export async function reportProductIncident(
  pool: Pool,
  authorization: string | null,
  planId: string,
  stopId: string,
  shipmentId: string,
  raw: Record<string, unknown>,
  timezone: string,
  at = new Date(),
  evidence?: Pick<
    Awaited<ReturnType<typeof storeIncidentEvidence>>,
    "id" | "hash" | "bytes"
  >,
  extraEvidence: Pick<
    Awaited<ReturnType<typeof storeIncidentEvidence>>,
    "id" | "hash" | "bytes"
  >[] = [],
) {
  const identity = serviceIdentity(raw),
    input = productIncidentInput(raw);
  const photos = [...(evidence ? [evidence] : []), ...extraEvidence];
  productPhotoCount(photos.length);
  if (extraEvidence.length && !evidence)
    throw new AppError("INVALID_PRODUCT_PHOTO_COUNT");
  const shipment = uuid(shipmentId),
    version = integer(raw.orderVersion, 1);
  return transaction(pool, async (sql) => {
    const context = await lockServiceContext(
      sql,
      authorization,
      planId,
      stopId,
      identity,
      {
        command: "product-incident",
        shipment,
        version,
        ...input,
        ...(evidence ? { contentHash: evidence.hash } : {}),
        ...(extraEvidence.length
          ? { extraContentHashes: extraEvidence.map((photo) => photo.hash) }
          : {}),
      },
    );
    if (context.previous) return context.previous;
    const { route, driver, stop, hash } = context;
    requireProductEvidence(input.kind, !!evidence);
    const order = (
      await sql.query(
        `SELECT status,version FROM route_driver_execution_orders
      WHERE execution_id=$1 AND stop_id=$2 AND shipment_id=$3 FOR UPDATE`,
        [route.id, stop!.id, shipment],
      )
    ).rows[0];
    if (!order) throw new AppError("NOT_FOUND", 404);
    if (order.version !== version) throw new AppError("VERSION_CONFLICT", 409);
    if (!["open", "rejected", "closed_pending"].includes(order.status))
      throw new AppError("ORDER_STATE_CONFLICT", 409);
    if (
      order.status === "closed_pending" &&
      (
        await sql.query(
          `SELECT 1 FROM route_driver_service_incidents
      WHERE execution_id=$1 AND stop_id=$2 AND kind='customer_closed' AND visit_sequence=$3`,
          [route.id, stop!.id, stop!.visit_sequence],
        )
      ).rowCount
    )
      throw new AppError("RETRY_REQUIRES_NEW_ARRIVAL", 409);
    const snapshot = (
      await sql.query(
        `SELECT pub.snapshot FROM route_plan_publications pub
      WHERE pub.plan_id=$1 AND pub.vehicle_id=$2 AND pub.revision=$3`,
        [route.plan_id, route.vehicle_id, route.publication_revision],
      )
    ).rows[0]?.snapshot;
    const source = snapshot?.orders.find(
      (o: { id: string }) => o.id === shipment,
    );
    if (!source) throw new AppError("NOT_FOUND", 404);
    const line =
      input.lineIndex === null ? null : source.lines[input.lineIndex];
    if (input.lineIndex !== null && !line)
      throw new AppError("INVALID_PRODUCT_LINE");
    const financialLine = input.financial
      ? await lockIncidentFinancialSource(
          sql,
          shipment,
          source.lines,
          input.lineIndex!,
          input.financial,
          at,
        )
      : null;
    if (input.financialContractVersion && line && !input.financial)
      await assertUnpricedIncidentSource(sql, shipment);
    const sourceQuantity = line
      ? incidentQuantity(financialLine?.quantity ?? line.quantity)
      : null;
    if (sourceQuantity !== null) {
      const available = (
        await sql.query(
          `SELECT $3::numeric+COALESCE(sum(quantity),0)<=$4::numeric AS valid
        FROM route_product_incidents WHERE execution_id=$1 AND shipment_id=$2 AND line_index=$5 AND status<>'canceled'`,
          [route.id, shipment, input.quantity, sourceQuantity, input.lineIndex],
        )
      ).rows[0].valid;
      if (!available) throw new AppError("INCIDENT_QUANTITY_EXCEEDED", 409);
    }
    const id = randomUUID();
    const classification =
      input.formVersion !== undefined
        ? { department: input.department, concept: input.concept }
        : productIncidentClassification(input.kind, input.department);
    await sql.query(
      `INSERT INTO route_product_incidents
      (id,execution_id,stop_id,shipment_id,driver_id,visit_sequence,kind,line_index,product,unit,quantity,
       source_quantity,note,order_name,occurred_at,event_date,timezone,snapshot,department,concept,warehouse_reason,
       evidence_id,evidence_hash,evidence_bytes,form_comments,additional_note,form_updated,
       financial_revision,financial_move_id,financial_sale_line_id,replacement_payment)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
      [
        id,
        route.id,
        stop!.id,
        shipment,
        driver.driver_id,
        stop!.visit_sequence,
        input.kind,
        input.lineIndex,
        line?.name ?? input.product,
        financialLine?.uom ?? line?.unit ?? input.unit,
        input.quantity,
        sourceQuantity,
        input.note,
        source.orderName,
        at,
        todayInTimezone(timezone, at),
        timezone,
        JSON.stringify({
          ...serviceSnapshot(route, stop!),
          reportedDepartment: input.department,
          ...(input.formVersion !== undefined
            ? {
                reportedConcept: input.concept,
                comments: input.comments,
                additionalNote: input.additionalNote,
              }
            : {}),
        }),
        classification.department,
        classification.concept,
        input.warehouseReason,
        evidence?.id ?? null,
        evidence?.hash ?? null,
        evidence?.bytes ?? null,
        JSON.stringify(input.formVersion !== undefined ? input.comments : []),
        input.formVersion !== undefined ? input.additionalNote : input.note,
        input.formVersion !== undefined,
        input.financial?.revision ?? null,
        input.financial?.moveId ?? null,
        input.financial?.saleLineId ?? null,
        input.replacementPayment ?? null,
      ],
    );
    for (const [index, photo] of extraEvidence.entries())
      await sql.query(
        `INSERT INTO route_product_incident_photos
      (incident_id,position,evidence_id,evidence_hash,evidence_bytes) VALUES($1,$2,$3,$4,$5)`,
        [id, index + 2, photo.id, photo.hash, photo.bytes],
      );
    await sql.query(
      "UPDATE route_driver_execution_orders SET version=version+1,updated_at=$3 WHERE execution_id=$1 AND shipment_id=$2",
      [route.id, shipment, at],
    );
    await sql.query(
      "UPDATE route_driver_execution_stops SET version=version+1 WHERE id=$1",
      [stop!.id],
    );
    await sql.query(
      "UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1",
      [route.id],
    );
    await sql.query(
      "INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'mobile.product_incident.created',$2)",
      [
        driver.driver_id,
        JSON.stringify({
          incidentId: id,
          executionId: route.id,
          shipmentId: shipment,
          kind: input.kind,
          deviceId: driver.device_id,
        }),
      ],
    );
    return saveDriverCommandReceipt(
      sql,
      driver.device_id,
      identity.commandId,
      hash,
      route.id,
      {
        eventId: null,
        incidentId: id,
        occurredAt: at.toISOString(),
        executionRevision: route.revision + 1,
        duplicate: false,
      },
    );
  });
}

export async function changeProductIncident(
  pool: Pool,
  authorization: string | null,
  planId: string,
  stopId: string,
  shipmentId: string,
  incidentId: string,
  raw: Record<string, unknown>,
  action: "amend" | "cancel",
) {
  const identity = serviceIdentity(raw),
    shipment = uuid(shipmentId),
    target = uuid(incidentId);
  const orderVersion = integer(raw.orderVersion, 1),
    expectedVersion = integer(raw.expectedVersion, 1);
  const form = action === "amend" ? productIncidentInput(raw) : null;
  if (form && form.formVersion === undefined)
    throw new AppError("INVALID_PRODUCT_FORM");
  return transaction(pool, async (sql) => {
    const { previous, driver, route, stop, hash } = await lockServiceContext(
      sql,
      authorization,
      planId,
      stopId,
      identity,
      {
        command: `product-incident-${action}`,
        shipment,
        target,
        orderVersion,
        expectedVersion,
        ...(form ?? {}),
      },
    );
    if (previous) return previous;
    const order = (
      await sql.query(
        `SELECT status,version FROM route_driver_execution_orders
      WHERE execution_id=$1 AND stop_id=$2 AND shipment_id=$3 FOR UPDATE`,
        [route.id, stop!.id, shipment],
      )
    ).rows[0];
    if (!order) throw new AppError("NOT_FOUND", 404);
    if (order.version !== orderVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    if (!["open", "rejected", "closed_pending"].includes(order.status))
      throw new AppError("ORDER_STATE_CONFLICT", 409);
    if (
      order.status === "closed_pending" &&
      (
        await sql.query(
          `SELECT 1 FROM route_driver_service_incidents
      WHERE execution_id=$1 AND stop_id=$2 AND kind='customer_closed' AND visit_sequence=$3`,
          [route.id, stop!.id, stop!.visit_sequence],
        )
      ).rowCount
    )
      throw new AppError("RETRY_REQUIRES_NEW_ARRIVAL", 409);
    const old = (
      await sql.query(
        `SELECT * FROM route_product_incidents
      WHERE id=$1 AND execution_id=$2 AND stop_id=$3 AND shipment_id=$4 AND driver_id=$5 FOR UPDATE`,
        [target, route.id, stop!.id, shipment, driver.driver_id],
      )
    ).rows[0];
    if (!old) throw new AppError("NOT_FOUND", 404);
    if (
      old.version !== expectedVersion ||
      old.status !== "pending" ||
      old.report_removed_at !== null
    )
      throw new AppError("VERSION_CONFLICT", 409);
    if (old.visit_sequence !== stop!.visit_sequence)
      throw new AppError("VISIT_NOT_ACTIVE", 409);
    let sourceQuantity = old.source_quantity,
      sourceUnit = old.unit;
    if (form) {
      requireProductEvidence(form.kind, old.evidence_id !== null);
      if (form.lineIndex !== old.line_index)
        throw new AppError("INVALID_PRODUCT_LINE");
      if (form.lineIndex !== null) {
        if (old.financial_revision !== null && !form.financial)
          throw new AppError("FINANCIAL_REFERENCE_REQUIRED", 409);
        if (form.financial) {
          const snapshot = (
            await sql.query(
              `SELECT snapshot FROM route_plan_publications
            WHERE plan_id=$1 AND vehicle_id=$2 AND revision=$3`,
              [route.plan_id, route.vehicle_id, route.publication_revision],
            )
          ).rows[0].snapshot;
          const published = snapshot.orders.find(
            (item: { id: string }) => item.id === shipment,
          );
          const line = await lockIncidentFinancialSource(
            sql,
            shipment,
            published.lines,
            form.lineIndex,
            form.financial,
          );
          sourceQuantity = incidentQuantity(line.quantity);
          sourceUnit = line.uom;
        } else if (form.financialContractVersion)
          await assertUnpricedIncidentSource(sql, shipment);
        const available = (
          await sql.query(
            `SELECT $3::numeric+COALESCE(sum(quantity),0)<=$4::numeric AS valid
          FROM route_product_incidents WHERE execution_id=$1 AND shipment_id=$2 AND line_index=$5
            AND id<>$6 AND status<>'canceled'`,
            [
              route.id,
              shipment,
              form.quantity,
              sourceQuantity,
              old.line_index,
              target,
            ],
          )
        ).rows[0].valid;
        if (!available) throw new AppError("INCIDENT_QUANTITY_EXCEEDED", 409);
      }
    }
    await sql.query(
      "SELECT set_config('ana.product_incident_command_id',$1,true)",
      [identity.commandId],
    );
    await sql.query(
      "SELECT set_config('ana.product_incident_actor_id',$1,true)",
      [driver.driver_id],
    );
    if (form)
      await sql.query(
        `UPDATE route_product_incidents SET kind=$2,warehouse_reason=$3,
      product=$4,unit=$5,quantity=$6,note=$7,department=$8,concept=$9,form_comments=$10,
      additional_note=$11,form_updated=true,source_quantity=$12,financial_revision=$13,financial_move_id=$14,
      financial_sale_line_id=$15,replacement_payment=$16,version=version+1 WHERE id=$1`,
        [
          target,
          form.kind,
          form.warehouseReason,
          form.lineIndex === null ? form.product : old.product,
          form.lineIndex === null ? form.unit : sourceUnit,
          form.quantity,
          form.note,
          form.department,
          form.concept,
          JSON.stringify(form.comments),
          form.additionalNote,
          sourceQuantity,
          form.financial?.revision ?? null,
          form.financial?.moveId ?? null,
          form.financial?.saleLineId ?? null,
          form.replacementPayment ?? null,
        ],
      );
    else
      await sql.query(
        `UPDATE route_product_incidents SET status='canceled',canceled_at=now(),
      canceled_by=$2,version=version+1 WHERE id=$1`,
        [target, driver.driver_id],
      );
    await sql.query(
      "UPDATE route_driver_execution_orders SET version=version+1,updated_at=now() WHERE execution_id=$1 AND shipment_id=$2",
      [route.id, shipment],
    );
    await sql.query(
      "UPDATE route_driver_execution_stops SET version=version+1 WHERE id=$1",
      [stop!.id],
    );
    await sql.query(
      "UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1",
      [route.id],
    );
    await sql.query(
      "INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,$2,$3)",
      [
        driver.driver_id,
        `mobile.product_incident.${action === "amend" ? "amended" : "canceled"}`,
        JSON.stringify({
          incidentId: target,
          executionId: route.id,
          shipmentId: shipment,
          deviceId: driver.device_id,
        }),
      ],
    );
    return saveDriverCommandReceipt(
      sql,
      driver.device_id,
      identity.commandId,
      hash,
      route.id,
      {
        eventId: null,
        incidentId: target,
        occurredAt: new Date().toISOString(),
        executionRevision: route.revision + 1,
        duplicate: false,
      },
    );
  });
}

export async function classifyProductIncident(
  pool: Pool,
  actor: string,
  id: string,
  raw: Record<string, unknown>,
) {
  const incidentId = uuid(id),
    version = integer(raw.expectedVersion, 1),
    next = incidentClassificationInput(raw);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const row = (
      await sql.query(
        `SELECT department,concept,version,status,report_removed_at,kind,
          (SELECT comment FROM route_product_incident_annotations WHERE incident_id=id) AS admin_comment
         FROM route_product_incidents WHERE id=$1 FOR UPDATE`,
        [incidentId],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    if (row.status === "canceled" || row.report_removed_at !== null)
      throw new AppError("INCIDENT_CANCELED", 409);
    if (!reportableProductIncidentKinds.some(kind => kind === row.kind))
      throw new AppError("NOT_FOUND", 404);
    if (row.version !== version) throw new AppError("VERSION_CONFLICT", 409);
    await sql.query("SELECT set_config('ana.product_incident_actor_id',$1,true)", [actor]);
    const result = await sql.query(
      `UPDATE route_product_incidents SET department=$2,concept=$3,version=version+1
      WHERE id=$1 RETURNING version`,
      [incidentId, next.department, next.concept],
    );
    if (next.comment !== undefined)
      await sql.query(`INSERT INTO route_product_incident_annotations(incident_id,comment,updated_by)
        VALUES($1,$2,$3) ON CONFLICT(incident_id) DO UPDATE
        SET comment=EXCLUDED.comment,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [incidentId, next.comment, actor]);
    await audit(sql, actor, "product_incident.classified", incidentId, {
      before: { department: row.department, concept: row.concept, comment: row.admin_comment },
      after: { ...next, comment: next.comment === undefined ? row.admin_comment : next.comment },
    });
    return { ...next, version: result.rows[0].version };
  });
}

export async function readProductIncidents(
  pool: Pool,
  actor: string,
  params: URLSearchParams,
  timezone: string,
  mode: "history" | "live" | "export" = "history",
): Promise<ProductIncidentReport> {
  const filters =
    mode === "live"
      ? incidentFilters(params, timezone, "all")
      : incidentFilters(params, timezone);
  return transaction(pool, async (sql) => {
    await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await assertActiveActor(sql, actor);
    const where = `FROM route_product_incidents WHERE ($1::date IS NULL OR event_date>=$1::date)
      AND ($2::date IS NULL OR event_date<=$2::date) AND ($3::uuid IS NULL OR driver_id=$3) AND status<>'canceled' AND report_removed_at IS NULL
      AND kind=ANY($4::text[]) ${mode === "live" ? "AND status='pending'" : ""}`;
    const values = [filters.from, filters.to, filters.driverId,
      mode === "live" ? ["replacement_quality", "replacement_wrong_product"] : reportableProductIncidentKinds];
    const pending = (
      await sql.query(
        `SELECT count(*)::int AS n ${where} AND status='pending'`,
        values,
      )
    ).rows[0].n;
    const { rows } = await sql.query(
      `SELECT *,quantity::text,event_date::text AS date_text,
      (SELECT comment FROM route_product_incident_annotations WHERE incident_id=route_product_incidents.id) AS admin_comment,
      ARRAY(SELECT evidence_id FROM route_product_incident_photos photos WHERE photos.incident_id=route_product_incidents.id ORDER BY position) AS extra_evidence_ids,
      to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time ${where}
      AND ($5::timestamptz IS NULL OR (occurred_at,id)<($5::timestamptz,$6::uuid))
      ORDER BY occurred_at DESC,id DESC ${mode === "export" ? "" : "LIMIT 51"}`,
      [
        ...values,
        mode === "export" ? null : (filters.cursor?.time ?? null),
        mode === "export" ? null : (filters.cursor?.id ?? null),
      ],
    );
    const page = mode === "export" ? rows : rows.slice(0, 50),
      last = page.at(-1);
    return {
      pending,
      rows: page.map((row) => ({
        id: row.id,
        executionId: row.execution_id,
        shipmentId: row.shipment_id,
        lineIndex: row.line_index,
        kind: row.kind,
        product: row.product,
        quantity: row.quantity,
        unit: row.unit,
        note: row.admin_comment ?? row.note,
        originalNote: row.note,
        adminComment: row.admin_comment,
        orderName: row.order_name,
        occurredAt: row.occurred_at.toISOString(),
        date: row.date_text,
        timezone: row.timezone,
        driverId: row.driver_id,
        snapshot: row.snapshot,
        status: row.status,
        version: row.version,
        department: row.department,
        concept: row.concept,
        resolutionNote: row.resolution_note,
        warehouseReason: row.warehouse_reason,
        evidenceId: row.evidence_id,
        evidenceIds: [
          ...(row.evidence_id ? [row.evidence_id] : []),
          ...row.extra_evidence_ids,
        ],
      })),
      nextCursor:
        mode !== "export" && rows.length > 50
          ? Buffer.from(
              JSON.stringify({
                filterHash: filters.filterHash,
                time: last.cursor_time,
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
  });
}

export async function resolveProductIncident(
  pool: Pool,
  actor: string,
  id: string,
  raw: Record<string, unknown>,
) {
  const incidentId = uuid(id),
    version = integer(raw.expectedVersion, 1);
  const note = serviceNote(raw.note);
  if (!note) throw new AppError("RESOLUTION_NOTE_REQUIRED");
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const row = (
      await sql.query(
        "SELECT status,version,report_removed_at FROM route_product_incidents WHERE id=$1 FOR UPDATE",
        [incidentId],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    if (
      row.version !== version ||
      row.status !== "pending" ||
      row.report_removed_at !== null
    )
      throw new AppError("VERSION_CONFLICT", 409);
    await sql.query(
      `UPDATE route_product_incidents SET status='resolved',resolved_at=now(),resolved_by=$2,
      resolution_note=$3,version=version+1 WHERE id=$1`,
      [incidentId, actor, note],
    );
    await audit(sql, actor, "product_incident.resolved", incidentId, { note });
    return { resolved: true };
  });
}
