import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "./errors";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { uuid } from "./orders-validation";
import { bindOdooSource } from "./odoo-source";
import type {
  Customer,
  CustomerList,
  CustomerSyncPage,
  CustomerSyncResult,
  SourceCustomer,
} from "./customers-contract";
import {
  archiveInput,
  customerInput,
  daysMask,
  mapsUrl,
  maskDays,
  normalizeSearch,
} from "./customers-validation";
import type { SourceShipment } from "./orders-contract";

type Row = Record<string, unknown>;

function searchKey(parts: unknown[]) {
  return normalizeSearch(
    parts
      .filter((part) => typeof part === "string" || typeof part === "number")
      .join(" "),
  );
}

function toCustomer(row: Row, windows: Row[] = []): Customer {
  return {
    id: String(row.id),
    odooPartnerId: Number(row.odoo_partner_id),
    odooParentId:
      row.odoo_parent_id === null ? null : Number(row.odoo_parent_id),
    odooCommercialPartnerId:
      row.odoo_commercial_partner_id === null
        ? null
        : Number(row.odoo_commercial_partner_id),
    odooType: String(row.odoo_type),
    odooIsCompany: Boolean(row.odoo_is_company),
    odooActive: Boolean(row.odoo_active),
    odooName: String(row.odoo_name),
    odooRef: row.odoo_ref === null ? null : String(row.odoo_ref),
    odooPhone: row.odoo_phone === null ? null : String(row.odoo_phone),
    odooMobile: row.odoo_mobile === null ? null : String(row.odoo_mobile),
    odooAddress: String(row.odoo_address),
    parentName:
      row.parent_name === null || row.parent_name === undefined
        ? null
        : String(row.parent_name),
    commercialName:
      row.commercial_name === null || row.commercial_name === undefined
        ? null
        : String(row.commercial_name),
    displayName: String(row.display_name),
    phone: row.phone === null ? null : String(row.phone),
    deliveryNote: String(row.delivery_note),
    priority: row.priority as Customer["priority"],
    fulfillmentMode: row.fulfillment_mode as Customer["fulfillmentMode"],
    deliveryAddress: String(row.delivery_address),
    mapUrl: row.map_url === null ? null : String(row.map_url),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    placeId: row.place_id === null ? null : String(row.place_id),
    locationStatus: row.location_status as Customer["locationStatus"],
    locationVersion: Number(row.location_version),
    archivedAt:
      row.archived_at === null
        ? null
        : new Date(String(row.archived_at)).toISOString(),
    version: Number(row.version),
    windows: windows.map((window) => ({
      id: String(window.id),
      days: maskDays(Number(window.days_mask)),
      startMinute: Number(window.start_minute),
      endMinute: Number(window.end_minute),
      position: Number(window.position),
    })),
  };
}

const selectCustomer = `
  SELECT c.*,p.odoo_name AS parent_name,commercial.odoo_name AS commercial_name
  FROM route_customers c
  LEFT JOIN route_customers p
    ON p.source=c.source AND p.odoo_partner_id=c.odoo_parent_id
  LEFT JOIN route_customers commercial
    ON commercial.source=c.source
    AND commercial.odoo_partner_id=c.odoo_commercial_partner_id`;

async function customerWindows(sql: Sql, ids: string[]) {
  if (!ids.length) return new Map<string, Row[]>();
  const { rows } = await sql.query(
    `SELECT id,customer_id,days_mask,start_minute,end_minute,position
     FROM route_customer_windows WHERE customer_id=ANY($1::uuid[])
     ORDER BY customer_id,position`,
    [ids],
  );
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const id = String(row.customer_id);
    grouped.set(id, [...(grouped.get(id) || []), row]);
  }
  return grouped;
}

async function customerRow(sql: Sql, id: string, lock = false) {
  const { rows } = await sql.query(
    `${selectCustomer} WHERE c.id=$1 ${lock ? "FOR UPDATE OF c" : ""}`,
    [uuid(id)],
  );
  if (!rows.length) throw new AppError("NOT_FOUND", 404);
  return rows[0] as Row;
}

export async function getCustomer(sql: Sql, id: string) {
  const row = await customerRow(sql, id);
  const grouped = await customerWindows(sql, [String(row.id)]);
  return toCustomer(row, grouped.get(String(row.id)) || []);
}

export async function listCustomers(
  sql: Sql,
  options: {
    archived: boolean;
    query?: string;
    after?: number;
    limit?: number;
  },
): Promise<CustomerList> {
  const limit = Math.min(Math.max(options.limit || 100, 1), 500);
  const after = Math.max(options.after || 0, 0);
  const query = normalizeSearch(options.query || "");
  const counts = await sql.query(
    `SELECT count(*) FILTER (WHERE archived_at IS NULL)::integer AS active,
            count(*) FILTER (WHERE archived_at IS NOT NULL)::integer AS archived
     FROM route_customers`,
  );
  const { rows } = await sql.query(
    `${selectCustomer}
     WHERE (c.archived_at IS NOT NULL)=$1
       AND c.odoo_partner_id>$2
       AND ($3='' OR strpos(c.search_key,$3)>0)
     ORDER BY c.odoo_partner_id,c.id LIMIT $4`,
    [options.archived, after, query, limit + 1],
  );
  const page = rows.slice(0, limit) as Row[];
  const grouped = await customerWindows(
    sql,
    page.map((row) => String(row.id)),
  );
  const customers = page.map((row) =>
    toCustomer(row, grouped.get(String(row.id)) || []),
  );
  return {
    customers,
    active: counts.rows[0]?.active || 0,
    archived: counts.rows[0]?.archived || 0,
    hasMore: rows.length > limit,
    nextCursor: customers.length
      ? String(customers[customers.length - 1].odooPartnerId)
      : null,
  };
}

export async function listAllCustomers(
  sql: Sql,
  options: { archived: boolean; query?: string },
) {
  const output: Customer[] = [];
  let after = 0;
  while (true) {
    const page = await listCustomers(sql, { ...options, after, limit: 500 });
    output.push(...page.customers);
    if (!page.hasMore || !page.nextCursor) return output;
    const next = Number(page.nextCursor);
    if (!Number.isSafeInteger(next) || next <= after)
      throw new AppError("SERVICE_UNAVAILABLE", 503);
    after = next;
  }
}

export function customerExportSnapshot(
  pool: Pool,
  options: { archived: boolean; query?: string },
) {
  return transaction(pool, async (sql) => {
    await sql.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    return listAllCustomers(sql, options);
  });
}

function sourceSnapshot(customer: SourceCustomer) {
  return JSON.stringify(customer);
}

export async function persistCustomerPage(
  pool: Pool,
  actor: string,
  page: CustomerSyncPage,
): Promise<CustomerSyncResult> {
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    await bindOdooSource(sql, page.fingerprint);
    const counts = { inserted: 0, existing: 0, sourceChanged: 0 };
    for (const customer of page.customers) {
      const snapshot = sourceSnapshot(customer);
      const hash = createHash("sha256").update(snapshot).digest("hex");
      const initialPhone = customer.phone || customer.mobile;
      const initialSearch = searchKey([
        customer.name,
        initialPhone,
        customer.phone,
        customer.mobile,
        customer.address,
        customer.reference,
        customer.parentName,
        customer.commercialName,
        customer.partnerId,
      ]);
      const inserted = await sql.query(
        `INSERT INTO route_customers(
          id,source,odoo_partner_id,odoo_parent_id,odoo_commercial_partner_id,
          odoo_company_id,odoo_type,odoo_is_company,odoo_active,odoo_name,
          odoo_ref,odoo_phone,odoo_mobile,odoo_address,source_snapshot,
          source_hash,display_name,phone,delivery_address,search_key,
          created_by,updated_by
        ) VALUES(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$10,$17,$14,$18,$19,$19
        ) ON CONFLICT(source,odoo_partner_id) DO NOTHING RETURNING id`,
        [
          randomUUID(),
          page.fingerprint,
          customer.partnerId,
          customer.parentId,
          customer.commercialPartnerId,
          customer.companyId,
          customer.type,
          customer.isCompany,
          customer.active,
          customer.name,
          customer.reference,
          customer.phone,
          customer.mobile,
          customer.address,
          snapshot,
          hash,
          initialPhone,
          initialSearch,
          actor,
        ],
      );
      if (inserted.rowCount) {
        counts.inserted++;
        continue;
      }
      const current = await sql.query(
        `SELECT id,source_hash,display_name,display_name_overridden,phone,
                phone_overridden,delivery_address,address_overridden,
                delivery_note,odoo_name,odoo_ref
         FROM route_customers WHERE source=$1 AND odoo_partner_id=$2 FOR UPDATE`,
        [page.fingerprint, customer.partnerId],
      );
      const row = current.rows[0];
      const localName = row.display_name;
      const localPhone = row.phone;
      const localAddress = row.delivery_address;
      const updatedSearch = searchKey([
        localName,
        customer.name,
        localPhone,
        customer.phone,
        customer.mobile,
        localAddress,
        customer.address,
        customer.reference,
        customer.parentName,
        customer.commercialName,
        customer.partnerId,
        row.delivery_note,
      ]);
      await sql.query(
        `UPDATE route_customers SET
          odoo_parent_id=$3,odoo_commercial_partner_id=$4,odoo_company_id=$5,
          odoo_type=$6,odoo_is_company=$7,odoo_active=$8,odoo_name=$9,
          odoo_ref=$10,odoo_phone=$11,odoo_mobile=$12,odoo_address=$13,
          source_snapshot=$14,source_hash=$15,search_key=$16,
          updated_at=CASE WHEN source_hash<>$15 THEN now() ELSE updated_at END
         WHERE source=$1 AND odoo_partner_id=$2`,
        [
          page.fingerprint,
          customer.partnerId,
          customer.parentId,
          customer.commercialPartnerId,
          customer.companyId,
          customer.type,
          customer.isCompany,
          customer.active,
          customer.name,
          customer.reference,
          customer.phone,
          customer.mobile,
          customer.address,
          snapshot,
          hash,
          updatedSearch,
        ],
      );
      if (row.source_hash === hash) counts.existing++;
      else counts.sourceChanged++;
    }
    await audit(sql, actor, "customers.synced", null, {
      ...counts,
      cursor: page.nextCursor,
      ceiling: page.ceiling,
      hasMore: page.hasMore,
    });
    return {
      ...counts,
      nextCursor: page.nextCursor,
      ceiling: page.ceiling,
      hasMore: page.hasMore,
    };
  });
}

export async function ensureCustomerFromShipment(
  sql: Sql,
  actor: string,
  source: string,
  shipment: SourceShipment,
) {
  const snapshot = JSON.stringify({
    partnerId: shipment.partnerId,
    name: shipment.customerName,
    address: shipment.address,
  });
  const hash = createHash("sha256").update(snapshot).digest("hex");
  await sql.query(
    `INSERT INTO route_customers(
      id,source,odoo_partner_id,odoo_name,odoo_address,source_snapshot,
      source_hash,display_name,delivery_address,search_key,created_by,updated_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$4,$5,$8,$9,$9)
    ON CONFLICT(source,odoo_partner_id) DO NOTHING`,
    [
      randomUUID(),
      source,
      shipment.partnerId,
      shipment.customerName,
      shipment.address,
      snapshot,
      hash,
      searchKey([shipment.customerName, shipment.address, shipment.partnerId]),
      actor,
    ],
  );
}

export async function updateCustomer(
  pool: Pool,
  actor: string,
  id: string,
  raw: Record<string, unknown>,
) {
  const input = customerInput(raw);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const previous = await customerRow(sql, id, true);
    if (Number(previous.version) !== input.expectedVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    const confirmed = input.location !== null;
    const locationChanged = confirmed
      ? previous.latitude !== input.location!.latitude ||
        previous.longitude !== input.location!.longitude ||
        previous.place_id !== input.location!.placeId ||
        previous.delivery_address !== input.deliveryAddress ||
        previous.location_status === "pending"
      : previous.latitude !== null || previous.longitude !== null;
    const locationVersion =
      Number(previous.location_version) +
      (confirmed && locationChanged ? 1 : 0);
    const generatedMapUrl = confirmed
      ? mapsUrl(input.location!.latitude, input.location!.longitude)
      : input.mapUrl;
    const key = searchKey([
      input.displayName,
      previous.odoo_name,
      input.phone,
      previous.odoo_phone,
      previous.odoo_mobile,
      input.deliveryAddress,
      previous.odoo_address,
      previous.odoo_ref,
      previous.odoo_partner_id,
      input.deliveryNote,
      previous.parent_name,
      previous.commercial_name,
    ]);
    await sql.query(
      `UPDATE route_customers SET
        display_name=$2,display_name_overridden=true,
        phone=$3,phone_overridden=true,delivery_note=$4,priority=$5,
        fulfillment_mode=$6,delivery_address=$7,address_overridden=true,
        map_url=$8,latitude=$9,longitude=$10,place_id=$11,
        location_status=$12,location_version=$13,search_key=$14,
        version=version+1,updated_by=$15,updated_at=now()
       WHERE id=$1`,
      [
        id,
        input.displayName,
        input.phone,
        input.deliveryNote,
        input.priority,
        input.fulfillmentMode,
        input.deliveryAddress,
        generatedMapUrl,
        input.location?.latitude ?? null,
        input.location?.longitude ?? null,
        input.location?.placeId ?? null,
        confirmed ? "confirmed" : "pending",
        locationVersion,
        key,
        actor,
      ],
    );
    await sql.query("DELETE FROM route_customer_windows WHERE customer_id=$1", [
      id,
    ]);
    for (const window of input.windows)
      await sql.query(
        `INSERT INTO route_customer_windows(
          id,customer_id,days_mask,start_minute,end_minute,position
        ) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          id,
          daysMask(window.days),
          window.startMinute,
          window.endMinute,
          window.position,
        ],
      );
    if (confirmed && locationChanged)
      await sql.query(
        `INSERT INTO route_customer_location_history(
          id,customer_id,location_version,address,latitude,longitude,
          place_id,map_url,source,actor_id
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'admin',$9)`,
        [
          randomUUID(),
          id,
          locationVersion,
          input.deliveryAddress,
          input.location!.latitude,
          input.location!.longitude,
          input.location!.placeId,
          generatedMapUrl,
          actor,
        ],
      );
    await audit(sql, actor, "customer.updated", id, {
      version: input.expectedVersion + 1,
      windows: input.windows.length,
      priority: input.priority,
      locationStatus: confirmed ? "confirmed" : "pending",
      locationVersion,
    });
    return getCustomer(sql, id);
  });
}

async function setArchived(
  pool: Pool,
  actor: string,
  id: string,
  raw: Record<string, unknown>,
  archived: boolean,
) {
  const input = archiveInput(raw);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const current = await customerRow(sql, id, true);
    if (Number(current.version) !== input.expectedVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    const already = (current.archived_at !== null) === archived;
    if (already) return getCustomer(sql, id);
    await sql.query(
      `UPDATE route_customers SET archived_at=${archived ? "now()" : "NULL"},
       archived_by=${archived ? "$2" : "NULL"},version=version+1,updated_by=$2,updated_at=now()
       WHERE id=$1`,
      [id, actor],
    );
    await audit(
      sql,
      actor,
      archived ? "customer.archived" : "customer.restored",
      id,
      { version: input.expectedVersion + 1 },
    );
    return getCustomer(sql, id);
  });
}

export function archiveCustomer(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  return setArchived(pool, actor, id, input, true);
}

export function restoreCustomer(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  return setArchived(pool, actor, id, input, false);
}
