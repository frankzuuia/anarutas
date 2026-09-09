import { randomUUID } from "node:crypto";
import { readOdooConfig } from "./config";
import { AppError } from "./errors";
import type { ImportPage, SourceShipment } from "./orders-contract";
import { integer } from "./orders-validation";
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

/** One bounded picking page; credentials, company, language and allowed models are server owned. */
export async function readFulfilledPage(
  range: { start: string; end: string },
  cursor = 0,
  ceiling?: number,
  config = readOdooConfig(),
): Promise<ImportPage> {
  integer(cursor);
  if (ceiling !== undefined) integer(ceiling);
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
  // These are the only two generic read methods, private to this closed domain service.
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
  const fields = await rpc(config, "object", "execute_kw", [
    ...prefix,
    "stock.move",
    "fields_get",
    [],
    { attributes: ["type", "relation"], context },
  ]);
  const quantityField = ["quantity", "quantity_done"].find(
    (k) => fields?.[k]?.type === "float",
  );
  const unitField = ["uom_id", "product_uom"].find(
    (k) => fields?.[k]?.relation === "uom.uom",
  );
  if (!quantityField || !unitField)
    throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  const base: unknown[] = [
    ["company_id", "=", config.companyId],
    ["state", "=", "done"],
    ["picking_type_code", "=", "outgoing"],
    ["location_dest_id.usage", "=", "customer"],
    ["date_done", ">=", range.start],
    ["date_done", "<", range.end],
  ];
  if (ceiling === undefined) {
    const highest = records(
      await rpc(config, "object", "execute_kw", [
        ...prefix,
        "stock.picking",
        "search_read",
        [base],
        { fields: ["id"], limit: 1, order: "id desc", context },
      ]),
    );
    ceiling = highest.length ? Number(highest[0].id) : 0;
  }
  const pickings = await search(
    "stock.picking",
    [...base, ["id", ">", cursor], ["id", "<=", ceiling]],
    ["id", "name", "company_id", "partner_id", "date_done", "backorder_id"],
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
      ceiling,
      hasMore: false,
    };
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
  const saleLines = await byIds(
    "sale.order.line",
    moves.map((m) => relation(m.sale_line_id)[0]),
    ["id", "order_id", ...(noteField ? [noteField] : [])],
  );
  const sales = await byIds(
    "sale.order",
    [...saleLines.values()].map((l) => relation(l.order_id)[0]),
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
    .filter((p) => p.partner_id)
    .map((p) => relation(p.partner_id)[0]);
  partnerIds.push(
    ...[...sales.values()].map((s) => relation(s.partner_shipping_id)[0]),
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
      (m) => relation(m.picking_id)[0] === picking.id,
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
            .filter((x) => typeof x === "string" && x.trim())
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
  return {
    fingerprint: config.fingerprint,
    shipments,
    inspected: pickings.length,
    excluded: pickings.length - new Set(shipments.map((s) => s.pickingId)).size,
    nextCursor,
    ceiling,
    hasMore: pickings.length === 50 && nextCursor < ceiling,
  };
}
