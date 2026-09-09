import { randomUUID } from "node:crypto";
import { readOdooConfig } from "./config";
import { AppError } from "./errors";
import type { ImportPage, SourceShipment } from "./orders-contract";
import { integer, orderNames as validateOrderNames } from "./orders-validation";
import { stockMoveCapabilities } from "./odoo-capabilities";
import { pickerNoteField, pickerNoteValue } from "./picker-notes";

type OdooConfig = ReturnType<typeof readOdooConfig>;
// Not exported: callers cannot select arbitrary models, methods, hosts or credentials.
async function rpc(
  config: OdooConfig,
  service: string,
  method: string,
  args: unknown[],
) {
  const id = randomUUID();
  let response: Response;
  try {
    response = await fetch(`${config.url}/jsonrpc`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new AppError("ODOO_UNAVAILABLE", 502);
  }
  if (!response.ok) throw new AppError("ODOO_UNAVAILABLE", 502);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  }
  if (data.id !== id || data.error || !Object.hasOwn(data, "result"))
    throw new AppError("ODOO_DENIED", 502);
  return data.result;
}
export function odooPublicStatus() {
  try {
    const config = readOdooConfig();
    return {
      configured: true,
      host: new URL(config.url).hostname,
      database: config.database,
      companyId: config.companyId,
      mode: "read-only",
    };
  } catch {
    return { configured: false, mode: "read-only" };
  }
}
export async function diagnoseOdoo(config = readOdooConfig()) {
  const version = await rpc(config, "common", "version", []);
  const uid = await rpc(config, "common", "authenticate", [
    config.database,
    config.username,
    config.credential,
    {},
  ]);
  if (!Number.isSafeInteger(uid) || uid <= 0)
    throw new AppError("ODOO_DENIED", 502);
  const prefix = [config.database, uid, config.credential];
  const users = await rpc(config, "object", "execute_kw", [
    ...prefix,
    "res.users",
    "read",
    [[uid]],
    { fields: ["company_ids"] },
  ]);
  if (
    !Array.isArray(users) ||
    !users[0]?.company_ids?.includes(config.companyId)
  )
    throw new AppError("ODOO_COMPANY_DENIED", 403);
  const companies = await rpc(config, "object", "execute_kw", [
    ...prefix,
    "res.company",
    "read",
    [[config.companyId]],
    { fields: ["name"], context: { allowed_company_ids: [config.companyId] } },
  ]);
  if (
    !Array.isArray(companies) ||
    companies.length !== 1 ||
    companies[0].id !== config.companyId
  )
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  return {
    connected: true,
    version: String(version.server_version),
    company: String(companies[0].name),
    companyId: config.companyId,
    fingerprint: config.fingerprint,
    mode: "read-only",
    checkedAt: new Date().toISOString(),
  };
}

type Row = Record<string, unknown>;
type ReadModel =
  | "stock.picking"
  | "stock.move"
  | "sale.order.line"
  | "sale.order"
  | "res.partner";
function records(value: unknown): Row[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (x) => x && typeof x === "object" && Number.isSafeInteger(x.id),
    )
  )
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  return value;
}
function relation(value: unknown): [number, string] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Number.isSafeInteger(value[0]) ||
    value[0] <= 0 ||
    typeof value[1] !== "string"
  )
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  return value as [number, string];
}
function odooDate(value: unknown): string {
  if (typeof value !== "string")
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  const parsed = new Date(value.replace(" ", "T") + "Z");
  if (!Number.isFinite(parsed.getTime()))
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  return parsed.toISOString();
}

type ReadSession = {
  config: OdooConfig;
  quantityField: string;
  unitField: string;
  noteField: string | null;
  latestPickingId: (domain: unknown[]) => Promise<number>;
  search: (
    model: ReadModel,
    domain: unknown[],
    fields: string[],
    limit: number,
  ) => Promise<Row[]>;
  all: (
    model: ReadModel,
    domain: unknown[],
    fields: string[],
  ) => Promise<Row[]>;
  byIds: (
    model: ReadModel,
    ids: number[],
    fields: string[],
    scoped?: boolean,
  ) => Promise<Map<number, Row>>;
};

async function openReadSession(config: OdooConfig): Promise<ReadSession> {
  const uid = await rpc(config, "common", "authenticate", [
    config.database,
    config.username,
    config.credential,
    {},
  ]);
  if (!Number.isSafeInteger(uid) || uid <= 0)
    throw new AppError("ODOO_DENIED", 502);
  const prefix = [config.database, uid, config.credential];
  const users = records(
    await rpc(config, "object", "execute_kw", [
      ...prefix,
      "res.users",
      "read",
      [[uid]],
      { fields: ["company_ids", "lang"] },
    ]),
  );
  if (
    !Array.isArray(users[0]?.company_ids) ||
    !users[0].company_ids.includes(config.companyId)
  )
    throw new AppError("ODOO_COMPANY_DENIED", 403);
  const context = {
    allowed_company_ids: [config.companyId],
    ...(typeof users[0].lang === "string" ? { lang: users[0].lang } : {}),
  };
  // This is the only generic record reader and it remains private to this closed domain service.
  const search = async (
    model: ReadModel,
    domain: unknown[],
    fields: string[],
    limit: number,
  ) =>
    records(
      await rpc(config, "object", "execute_kw", [
        ...prefix,
        model,
        "search_read",
        [domain],
        { fields, limit, order: "id asc", context },
      ]),
    );
  async function all(
    model: ReadModel,
    domain: unknown[],
    fieldNames: string[],
  ) {
    const result: Row[] = [];
    let after = 0;
    while (true) {
      const page = await search(
        model,
        [...domain, ["id", ">", after]],
        fieldNames,
        500,
      );
      result.push(...page);
      if (page.length < 500) return result;
      const last = Number(page[page.length - 1].id);
      if (last <= after) throw new AppError("ODOO_INVALID_RESPONSE", 502);
      after = last;
    }
  }
  async function byIds(
    model: ReadModel,
    ids: number[],
    names: string[],
    scoped = true,
  ) {
    const result: Row[] = [];
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 500) {
      const batch = unique.slice(i, i + 500);
      const rows = await all(
        model,
        [
          ["id", "in", batch],
          ...(scoped ? [["company_id", "=", config.companyId]] : []),
        ],
        names,
      );
      if (rows.length !== batch.length)
        throw new AppError("ODOO_INCOMPLETE_READ", 502);
      result.push(...rows);
    }
    return new Map(result.map((row) => [Number(row.id), row]));
  }
  const fields = await rpc(config, "object", "execute_kw", [
    ...prefix,
    "stock.move",
    "fields_get",
    [],
    { attributes: ["type", "relation"], context },
  ]);
  const { quantityField, unitField } = stockMoveCapabilities(fields);
  const saleMetadata = await rpc(config, "object", "execute_kw", [
    ...prefix,
    "sale.order.line",
    "fields_get",
    [],
    { attributes: ["type", "string"], context },
  ]);
  const noteField = pickerNoteField(
    saleMetadata,
    config.pickerNoteField,
    config.pickerNoteLabel,
  );
  const latestPickingId = async (domain: unknown[]) => {
    const rows = records(
      await rpc(config, "object", "execute_kw", [
        ...prefix,
        "stock.picking",
        "search_read",
        [domain],
        { fields: ["id"], limit: 1, order: "id desc", context },
      ]),
    );
    return rows.length ? Number(rows[0].id) : 0;
  };
  return {
    config,
    quantityField,
    unitField,
    noteField,
    latestPickingId,
    search,
    all,
    byIds,
  };
}

const pickingFields = [
  "id",
  "name",
  "company_id",
  "partner_id",
  "date_done",
  "backorder_id",
];

async function hydratePickings(session: ReadSession, pickings: Row[]) {
  const { config, quantityField, unitField, noteField, all, byIds } = session;
  if (!pickings.length) return [];
  const moves = await all(
    "stock.move",
    [
      ["company_id", "=", config.companyId],
      ["picking_id", "in", pickings.map((p) => p.id)],
      ["state", "=", "done"],
      ["sale_line_id", "!=", false],
      ["origin_returned_move_id", "=", false],
      [quantityField, ">", 0],
    ],
    [
      "id",
      "picking_id",
      "sale_line_id",
      "product_id",
      quantityField,
      unitField,
    ],
  );
  const saleLines = await byIds(
    "sale.order.line",
    moves.map((move) => relation(move.sale_line_id)[0]),
    ["id", "order_id", ...(noteField ? [noteField] : [])],
  );
  const sales = await byIds(
    "sale.order",
    [...saleLines.values()].map((line) => relation(line.order_id)[0]),
    [
      "id",
      "name",
      "state",
      "company_id",
      "partner_shipping_id",
      "commitment_date",
    ],
  );
  const partnerIds = pickings
    .filter((picking) => picking.partner_id)
    .map((picking) => relation(picking.partner_id)[0]);
  partnerIds.push(
    ...[...sales.values()].map((sale) => relation(sale.partner_shipping_id)[0]),
  );
  const partners = await byIds(
    "res.partner",
    partnerIds,
    [
      "id",
      "name",
      "street",
      "street2",
      "city",
      "zip",
      "state_id",
      "country_id",
    ],
    false,
  );
  const shipments: SourceShipment[] = [];
  for (const picking of pickings) {
    const groups = new Map<number, SourceShipment>();
    for (const move of moves.filter(
      (record) => relation(record.picking_id)[0] === picking.id,
    )) {
      const saleLine = saleLines.get(relation(move.sale_line_id)[0])!;
      const orderId = relation(saleLine.order_id)[0];
      const sale = sales.get(orderId)!;
      if (sale.state !== "sale" && sale.state !== "done") continue;
      const partnerId = relation(
        picking.partner_id || sale.partner_shipping_id,
      )[0];
      const partner = partners.get(partnerId)!;
      if (!groups.has(orderId))
        groups.set(orderId, {
          pickingId: Number(picking.id),
          pickingName: String(picking.name),
          orderId,
          orderName: String(sale.name),
          partnerId,
          customerName: String(partner.name),
          address: [
            partner.street,
            partner.street2,
            partner.city,
            partner.state_id && relation(partner.state_id)[1],
            partner.zip,
            partner.country_id && relation(partner.country_id)[1],
          ]
            .filter((value) => typeof value === "string" && value.trim())
            .join(", "),
          validatedAt: odooDate(picking.date_done),
          promisedAt: sale.commitment_date
            ? odooDate(sale.commitment_date)
            : null,
          backorderId: picking.backorder_id
            ? relation(picking.backorder_id)[0]
            : null,
          lines: [],
        });
      const quantity = move[quantityField];
      if (
        typeof quantity !== "number" ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      )
        throw new AppError("ODOO_INVALID_RESPONSE", 502);
      const note = noteField ? pickerNoteValue(saleLine[noteField]) : undefined;
      groups.get(orderId)!.lines.push({
        moveId: Number(move.id),
        productId: relation(move.product_id)[0],
        name: relation(move.product_id)[1],
        quantity,
        unit: relation(move[unitField])[1],
        ...(note ? { pickerNote: note } : {}),
      });
    }
    shipments.push(...groups.values());
  }
  return shipments;
}

/** One bounded picking page; credentials, company, language and allowed models are server owned. */
export async function readFulfilledPage(
  range: { start: string; end: string },
  cursor = 0,
  ceiling?: number,
  config = readOdooConfig(),
): Promise<ImportPage> {
  integer(cursor);
  if (ceiling !== undefined) integer(ceiling);
  const session = await openReadSession(config);
  const base: unknown[] = [
    ["company_id", "=", config.companyId],
    ["state", "=", "done"],
    ["picking_type_code", "=", "outgoing"],
    ["location_dest_id.usage", "=", "customer"],
    ["date_done", ">=", range.start],
    ["date_done", "<", range.end],
  ];
  let pageCeiling = ceiling;
  if (pageCeiling === undefined)
    pageCeiling = await session.latestPickingId(base);
  const pickings = await session.search(
    "stock.picking",
    [...base, ["id", ">", cursor], ["id", "<=", pageCeiling]],
    pickingFields,
    50,
  );
  const nextCursor = pickings.length
    ? Number(pickings[pickings.length - 1].id)
    : cursor;
  if (!pickings.length)
    return {
      fingerprint: config.fingerprint,
      shipments: [],
      inspected: 0,
      excluded: 0,
      nextCursor,
      ceiling: pageCeiling,
      hasMore: false,
    };
  const shipments = await hydratePickings(session, pickings);
  return {
    fingerprint: config.fingerprint,
    shipments,
    inspected: pickings.length,
    excluded: pickings.length - new Set(shipments.map((s) => s.pickingId)).size,
    nextCursor,
    ceiling: pageCeiling,
    hasMore: pickings.length === 50 && nextCursor < pageCeiling,
  };
}

/** Exact sale folios; the date is deliberately absent while every other fulfillment rule remains. */
export async function readFulfilledByOrderNames(
  requested: unknown,
  config = readOdooConfig(),
): Promise<ImportPage> {
  const names = validateOrderNames(requested);
  const session = await openReadSession(config);
  const sales = await session.all(
    "sale.order",
    [
      ["company_id", "=", config.companyId],
      ["name", "in", names],
      ["state", "in", ["sale", "done"]],
    ],
    ["id", "name"],
  );
  const counts = new Map<string, number>();
  for (const sale of sales) {
    const name = String(sale.name);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const initiallyUnavailable = names.filter((name) => counts.get(name) !== 1);
  if (initiallyUnavailable.length)
    throw new AppError("MANUAL_ORDERS_UNAVAILABLE", 422, {
      unavailableFolios: initiallyUnavailable,
    });
  const lines = await session.all(
    "sale.order.line",
    [["order_id", "in", sales.map((sale) => sale.id)]],
    ["id"],
  );
  const moves = lines.length
    ? await session.all(
        "stock.move",
        [
          ["company_id", "=", config.companyId],
          ["sale_line_id", "in", lines.map((line) => line.id)],
          ["state", "=", "done"],
          ["picking_id", "!=", false],
          ["origin_returned_move_id", "=", false],
          [session.quantityField, ">", 0],
        ],
        ["id", "picking_id"],
      )
    : [];
  const pickingIds = [
    ...new Set(moves.map((move) => relation(move.picking_id)[0])),
  ];
  if (pickingIds.length > 500) throw new AppError("MANUAL_ORDERS_LIMIT", 422);
  const pickings = pickingIds.length
    ? await session.search(
        "stock.picking",
        [
          ["company_id", "=", config.companyId],
          ["id", "in", pickingIds],
          ["state", "=", "done"],
          ["picking_type_code", "=", "outgoing"],
          ["location_dest_id.usage", "=", "customer"],
        ],
        pickingFields,
        501,
      )
    : [];
  const requestedSet = new Set(names);
  const shipments = (await hydratePickings(session, pickings)).filter(
    (shipment) => requestedSet.has(shipment.orderName),
  );
  const eligible = new Set(shipments.map((shipment) => shipment.orderName));
  const unavailable = names.filter((name) => !eligible.has(name));
  if (unavailable.length)
    throw new AppError("MANUAL_ORDERS_UNAVAILABLE", 422, {
      unavailableFolios: unavailable,
    });
  return {
    fingerprint: config.fingerprint,
    shipments,
    inspected: pickings.length,
    excluded:
      pickings.length -
      new Set(shipments.map((shipment) => shipment.pickingId)).size,
    nextCursor: 0,
    ceiling: 0,
    hasMore: false,
  };
}
