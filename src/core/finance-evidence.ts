import type { Pool } from "pg";
import { transaction, assertActiveActor } from "./database";
import { mobileFinanceContext, lockFinanceExecution } from "./finance-context";
import { uuid } from "./orders-validation";
import { AppError } from "./errors";
import { readStoredIncidentEvidence } from "./driver-incident-evidence";
export async function readFinanceEvidence(
  pool: Pool,
  identity: { actor: string } | { authorization: string | null },
  executionId: string,
  incidentId: string,
  photoId: string,
  root?: string,
) {
  const incident = uuid(incidentId),
    photo = uuid(photoId);
  return transaction(pool, async (sql) => {
    if ("actor" in identity) {
      await assertActiveActor(sql, identity.actor, "settlement");
      await lockFinanceExecution(sql, executionId);
    } else await mobileFinanceContext(sql, identity.authorization, executionId);
    const row = await sql.query(
      `SELECT 1 FROM route_product_incidents i WHERE i.id=$1 AND i.execution_id=$2
     AND (i.evidence_id=$3 OR EXISTS(SELECT 1 FROM route_product_incident_photos p WHERE p.incident_id=i.id AND p.evidence_id=$3))
     AND ($4::boolean=false OR EXISTS(SELECT 1 FROM route_order_payments p WHERE (p.execution_id,p.shipment_id)=(i.execution_id,i.shipment_id)))`,
      [incident, executionId, photo, "actor" in identity],
    );
    if (!row.rowCount) throw new AppError("NOT_FOUND", 404);
    return readStoredIncidentEvidence(photo, root);
  });
}
