import type { Sql } from "./database";

export async function migrateIncidentFinancials(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS financial_revision integer CHECK(financial_revision>0);
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS financial_move_id bigint CHECK(financial_move_id>0);
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS financial_sale_line_id bigint CHECK(financial_sale_line_id>0);
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS replacement_payment text;
    -- Discover the two original unnamed constraints by their exact column sets.
    DO $$ DECLARE candidate record; kind_col smallint; line_col smallint; evidence_col smallint; BEGIN
      SELECT attnum INTO kind_col FROM pg_attribute WHERE attrelid='route_product_incidents'::regclass AND attname='kind';
      SELECT attnum INTO line_col FROM pg_attribute WHERE attrelid='route_product_incidents'::regclass AND attname='line_index';
      SELECT attnum INTO evidence_col FROM pg_attribute WHERE attrelid='route_product_incidents'::regclass AND attname='evidence_id';
      FOR candidate IN SELECT conname FROM pg_constraint WHERE conrelid='route_product_incidents'::regclass AND contype='c'
        AND cardinality(conkey)=2 AND (conkey @> ARRAY[kind_col,line_col] OR conkey @> ARRAY[line_col,evidence_col]) LOOP
        EXECUTE format('ALTER TABLE route_product_incidents DROP CONSTRAINT %I',candidate.conname);
      END LOOP;
    END $$;
    ALTER TABLE route_product_incidents DROP CONSTRAINT IF EXISTS product_incident_financial_reference;
    ALTER TABLE route_product_incidents ADD CONSTRAINT product_incident_financial_reference CHECK(
      num_nonnulls(financial_revision,financial_move_id,financial_sale_line_id)=0 OR
      (num_nonnulls(financial_revision,financial_move_id,financial_sale_line_id)=3 AND line_index IS NOT NULL));
    ALTER TABLE route_product_incidents DROP CONSTRAINT IF EXISTS product_incident_link_kind;
    ALTER TABLE route_product_incidents ADD CONSTRAINT product_incident_link_kind CHECK(
      (kind IN ('shortage_validation','shortage_warehouse') AND (line_index IS NULL OR financial_revision IS NOT NULL)) OR
      (kind NOT IN ('shortage_validation','shortage_warehouse') AND line_index IS NOT NULL));
    ALTER TABLE route_product_incidents DROP CONSTRAINT IF EXISTS product_incident_kind_evidence;
    ALTER TABLE route_product_incidents ADD CONSTRAINT product_incident_kind_evidence CHECK(
      kind IN ('shortage_validation','shortage_warehouse') OR evidence_id IS NOT NULL);
    ALTER TABLE route_product_incidents DROP CONSTRAINT IF EXISTS product_incident_replacement_payment;
    ALTER TABLE route_product_incidents ADD CONSTRAINT product_incident_replacement_payment CHECK(
      (replacement_payment IS NULL OR (kind IN ('replacement_quality','replacement_wrong_product') AND replacement_payment IN ('pay_full','defer')))
      AND (financial_revision IS NULL OR kind NOT IN ('replacement_quality','replacement_wrong_product') OR replacement_payment IS NOT NULL));

    CREATE OR REPLACE FUNCTION preserve_product_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
      IF (to_jsonb(NEW)-ARRAY['status','version','resolved_at','resolved_by','resolution_note','department','concept',
        'kind','warehouse_reason','product','unit','quantity','note','form_comments','form_updated','additional_note',
        'canceled_at','canceled_by','canceled_by_admin','report_removed_at','report_removed_by',
        'financial_revision','financial_move_id','financial_sale_line_id','replacement_payment','source_quantity'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','resolved_at','resolved_by','resolution_note','department','concept',
        'kind','warehouse_reason','product','unit','quantity','note','form_comments','form_updated','additional_note',
        'canceled_at','canceled_by','canceled_by_admin','report_removed_at','report_removed_by',
        'financial_revision','financial_move_id','financial_sale_line_id','replacement_payment','source_quantity']) THEN
        RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
      IF OLD.financial_revision IS NOT NULL AND (NEW.financial_revision IS NULL OR
        NEW.financial_move_id IS DISTINCT FROM OLD.financial_move_id OR NEW.financial_sale_line_id IS DISTINCT FROM OLD.financial_sale_line_id) THEN
        RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
      IF (NEW.financial_revision IS NULL AND NEW.source_quantity IS DISTINCT FROM OLD.source_quantity) OR
        (NEW.status IN ('resolved','canceled') AND (NEW.financial_revision,NEW.financial_move_id,NEW.financial_sale_line_id,NEW.replacement_payment,NEW.source_quantity)
          IS DISTINCT FROM (OLD.financial_revision,OLD.financial_move_id,OLD.financial_sale_line_id,OLD.replacement_payment,OLD.source_quantity)) THEN
        RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
      IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'PRODUCT_INCIDENT_VERSION' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;

    CREATE OR REPLACE FUNCTION validate_product_incident_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE source_line jsonb; imported_line jsonb; published_order jsonb; imported_order jsonb;
      financial jsonb; movement jsonb; total numeric;
    BEGIN
      IF TG_OP='UPDATE' AND NEW.status IN ('resolved','canceled') THEN RETURN NEW; END IF;
      PERFORM 1 FROM route_driver_execution_orders WHERE execution_id=NEW.execution_id
        AND stop_id=NEW.stop_id AND shipment_id=NEW.shipment_id FOR UPDATE;
      IF NEW.line_index IS NOT NULL THEN
        SELECT o,s.snapshot INTO published_order,imported_order
          FROM route_driver_executions e JOIN route_plan_publications p ON p.plan_id=e.plan_id
            AND p.vehicle_id=e.vehicle_id AND p.revision=e.publication_revision
          CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'orders') o
          JOIN route_shipments s ON s.id=NEW.shipment_id AND s.plan_id=e.plan_id
          WHERE e.id=NEW.execution_id AND o->>'id'=NEW.shipment_id::text;
        source_line=published_order->'lines'->NEW.line_index;
        IF NEW.financial_revision IS NULL THEN
          IF source_line IS NULL OR (source_line->>'quantity')::numeric IS DISTINCT FROM NEW.source_quantity
            OR source_line->>'name' IS DISTINCT FROM NEW.product OR source_line->>'unit' IS DISTINCT FROM NEW.unit THEN
            RAISE EXCEPTION 'INVALID_PRODUCT_LINE' USING ERRCODE='23514'; END IF;
        ELSE
          imported_line=imported_order->'lines'->NEW.line_index;
          SELECT r.snapshot INTO financial FROM route_shipments s JOIN route_financial_targets t
            ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id)
            JOIN route_financial_revisions r ON (r.source,r.picking_id,r.order_id,r.revision)=(t.source,t.picking_id,t.order_id,t.revision)
            WHERE s.id=NEW.shipment_id AND t.revision=NEW.financial_revision AND t.last_error IS NULL
              AND r.snapshot->>'status'='ready' FOR SHARE OF t;
          SELECT value INTO movement FROM jsonb_array_elements(financial->'lines') WHERE (value->>'id')::bigint=NEW.financial_move_id;
          IF source_line IS NULL OR imported_line IS NULL OR movement IS NULL
            OR (imported_line->>'moveId')::bigint IS DISTINCT FROM NEW.financial_move_id
            OR (movement->>'saleLineId')::bigint IS DISTINCT FROM NEW.financial_sale_line_id
            OR (movement->>'productId')::bigint IS DISTINCT FROM (imported_line->>'productId')::bigint
            OR (imported_line ? 'uomId' AND (imported_line->>'uomId')::bigint IS DISTINCT FROM (movement->>'uomId')::bigint)
            OR (imported_line ? 'saleLineId' AND (imported_line->>'saleLineId')::bigint IS DISTINCT FROM NEW.financial_sale_line_id)
            OR (movement->>'quantity')::numeric IS DISTINCT FROM NEW.source_quantity
            OR source_line->>'name' IS DISTINCT FROM NEW.product OR movement->>'uom' IS DISTINCT FROM NEW.unit
            OR jsonb_array_length(published_order->'lines')<>jsonb_array_length(imported_order->'lines')
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(published_order->'lines') WITH ORDINALITY item(line,n)
              WHERE (line->>'name',line->>'unit',(line->>'quantity')::numeric) IS DISTINCT FROM
                (imported_order->'lines'->(n::int-1)->>'name',imported_order->'lines'->(n::int-1)->>'unit',
                  (imported_order->'lines'->(n::int-1)->>'quantity')::numeric)) THEN
            RAISE EXCEPTION 'INVALID_FINANCIAL_INCIDENT' USING ERRCODE='23514'; END IF;
        END IF;
        SELECT COALESCE(sum(quantity),0) INTO total FROM route_product_incidents
          WHERE execution_id=NEW.execution_id AND shipment_id=NEW.shipment_id AND line_index=NEW.line_index
            AND id<>NEW.id AND status<>'canceled';
        IF total+NEW.quantity>NEW.source_quantity THEN
          RAISE EXCEPTION 'INCIDENT_QUANTITY_EXCEEDED' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS validate_product_incident ON route_product_incidents;
    CREATE TRIGGER validate_product_incident BEFORE INSERT OR UPDATE OF quantity,status,kind,product,unit,replacement_payment,financial_revision,financial_move_id,financial_sale_line_id,source_quantity
      ON route_product_incidents FOR EACH ROW EXECUTE FUNCTION validate_product_incident_quantity();
    CREATE OR REPLACE TRIGGER financial_projection_changed AFTER UPDATE OF revision,last_error,last_success_at ON route_financial_targets
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    UPDATE rutas_installation SET schema_version=35 WHERE singleton=true;
  `);
}
