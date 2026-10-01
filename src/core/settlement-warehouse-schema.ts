import type { Sql } from "./database";
import { settlementVerificationSql } from "./order-collection-schema";
import { routeWorkVerificationSql } from "./route-work-schema";

export async function migrateSettlementWarehouse(sql: Sql) {
  await sql.query(`
    -- Temporary test exception explicitly requested by the owner. Runtime policy,
    -- never a client switch or a fabricated operational route completion.
    ALTER TABLE route_driver_operation_settings
      ADD COLUMN IF NOT EXISTS settlement_require_warehouse boolean NOT NULL DEFAULT false;
    CREATE OR REPLACE FUNCTION route_settlement_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM route_driver_execution_completions WHERE execution_id=target)
        OR ((SELECT settlement_require_warehouse FROM route_driver_operation_settings WHERE singleton=true) IS FALSE
          AND EXISTS(SELECT 1 FROM route_driver_execution_orders WHERE execution_id=target)
          AND NOT EXISTS(SELECT 1 FROM route_driver_execution_orders WHERE execution_id=target AND status<>'delivered')
          AND NOT EXISTS(SELECT 1 FROM route_driver_execution_orders o WHERE o.execution_id=target
            AND NOT EXISTS(SELECT 1 FROM route_order_payments p WHERE (p.execution_id,p.shipment_id)=(o.execution_id,o.shipment_id))))
    $$;
    ${settlementVerificationSql}
    ${routeWorkVerificationSql}
    UPDATE rutas_installation SET schema_version=41 WHERE singleton=true;
  `);
}
