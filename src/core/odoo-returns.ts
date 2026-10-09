import Decimal from "decimal.js";
import { readOdooConfig } from "./config";
import { AppError } from "./errors";
import { odooRpc } from "./odoo-rpc";
import {
  assertReturnAvailable,
  assertReturnReceipt,
  convertReturnQuantity,
  returnCapabilities,
  returnReference,
  validateReturnRequest,
  type ReturnRequest,
  type ReturnReceipt,
} from "./odoo-return-policy";

type Row = Record<string, unknown>;
type Model =
  | "res.users"
  | "ir.model"
  | "stock.picking"
  | "stock.move"
  | "stock.location"
  | "stock.return.picking"
  | "stock.return.picking.line"
  | "uom.uom"
  | "sale.order";
type Method =
  | "read"
  | "search_read"
  | "fields_get"
  | "get_views"
  | "default_get"
  | "create"
  | "write"
  | "create_returns"
  | "action_create_returns"
  | "action_return"
  | "action_confirm"
  | "action_assign";
type Config = ReturnType<typeof readOdooConfig>;
const rows = (value: unknown): Row[] => {
  if (
    !Array.isArray(value) ||
    value.some((row) => !row || !Number.isSafeInteger(row.id))
  )
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  return value;
};
const relation = (value: unknown): number => {
  if (!Array.isArray(value) || !Number.isSafeInteger(value[0]) || value[0] < 1)
    throw new AppError("ODOO_RETURN_IDENTITY_INVALID", 409);
  return value[0];
};
async function session(config: Config) {
  const uid = await odooRpc(config, "common", "authenticate", [
    config.database,
    config.username,
    config.credential,
    {},
  ]);
  if (!Number.isSafeInteger(uid) || Number(uid) < 1)
    throw new AppError("ODOO_DENIED", 502);
  const context = {
    allowed_company_ids: [config.companyId],
    active_test: false,
  };
  const call = (
    model: Model,
    method: Method,
    args: unknown[],
    extra: Row = {},
  ) =>
    odooRpc(config, "object", "execute_kw", [
      config.database,
      uid,
      config.credential,
      model,
      method,
      args,
      { context, ...extra },
    ]);
  const user = rows(
    await call("res.users", "read", [[uid]], { fields: ["company_ids"] }),
  )[0];
  if (
    !Array.isArray(user?.company_ids) ||
    !user.company_ids.includes(config.companyId)
  )
    throw new AppError("ODOO_COMPANY_DENIED", 403);
  const fields = async (model: Model) =>
    (await call(model, "fields_get", [], {
      attributes: ["type", "relation"],
    })) as Record<string, { type?: string; relation?: string }>;
  const models = rows(
    await call(
      "ir.model",
      "search_read",
      [
        [
          [
            "model",
            "in",
            ["stock.return.picking", "stock.return.picking.line"],
          ],
        ],
      ],
      { fields: ["model"], limit: 3 },
    ),
  ).map((row) => String(row.model));
  const view = async (model: Model) => {
    const result = (await call(model, "get_views", [], {
      views: [[false, "form"]],
      options: {},
    })) as { views?: { form?: { arch?: string } } };
    return result.views?.form?.arch ?? "";
  };
  const caps = returnCapabilities(
    models,
    await fields("stock.move"),
    await fields("stock.picking"),
    await view("stock.picking"),
    models.includes("stock.return.picking")
      ? await view("stock.return.picking")
      : "",
  );
  return { call, caps, context };
}

export async function inspectOdooReturnContract(config = readOdooConfig()) {
  const { call, caps } = await session(config);
  const marker = "AR/RETURN/CONTRACT-CHECK";
  const defaults = (await call("stock.picking", "default_get", [["name"]], {
    context: { allowed_company_ids: [config.companyId], default_name: marker },
  })) as Row;
  if (defaults.name !== marker)
    throw new AppError("ODOO_RETURN_CORRELATION_UNSUPPORTED", 502);
  return { ...caps, source: config.fingerprint, companyId: config.companyId };
}

/** No generic RPC, no validation, no invoice/credit-note/payment operation is exposed. */
export async function prepareOdooReturn(
  request: ReturnRequest,
  progress: {
    started: boolean;
    remoteId: number | null;
    beforeCreate: () => Promise<void>;
    created: (id: number) => Promise<void>;
  },
  config = readOdooConfig(),
): Promise<ReturnReceipt> {
  validateReturnRequest(request, config.fingerprint, config.companyId);
  const { call, caps, context } = await session(config);
  const reference = returnReference(request.id);
  const search = async (model: Model, domain: unknown[], fields: string[]) => {
    const result: Row[] = [];
    let cursor = 0;
    for (;;) {
      const page = rows(
        await call(model, "search_read", [[...domain, ["id", ">", cursor]]], {
          fields,
          limit: 1000,
          order: "id",
        }),
      );
      if (page.some((row) => Number(row.id) <= cursor))
        throw new AppError("ODOO_INVALID_RESPONSE", 502);
      result.push(...page);
      if (page.length < 1000) return result;
      cursor = Number(page.at(-1)!.id);
    }
  };
  const pickingFields = [
    "name",
    "state",
    "company_id",
    "partner_id",
    "return_id",
    "picking_type_code",
    "location_id",
    "location_dest_id",
    "move_ids",
    "sale_id",
  ];
  const pickings = await search(
    "stock.picking",
    [
      ["id", "=", request.pickingId],
      ["company_id", "=", config.companyId],
      ["location_dest_id.usage", "=", "customer"],
    ],
    pickingFields,
  );
  const origin = pickings[0];
  if (
    pickings.length !== 1 ||
    origin.state !== "done" ||
    origin.return_id ||
    origin.picking_type_code !== "outgoing" ||
    relation(origin.partner_id) !== request.partnerId ||
    relation(origin.sale_id) !== request.orderId
  )
    throw new AppError("ODOO_RETURN_SOURCE_INVALID", 409);
  const verifyRemote = async (remote: Row | undefined) => {
    if (
      !remote ||
      remote.name !== reference ||
      relation(remote.company_id) !== config.companyId ||
      relation(remote.return_id) !== request.pickingId ||
      relation(remote.partner_id) !== request.partnerId ||
      relation(remote.location_id) !== relation(origin.location_dest_id) ||
      !["draft", "waiting", "confirmed", "assigned"].includes(
        String(remote.state),
      )
    )
      throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
    const locations = await search(
      "stock.location",
      [
        ["id", "=", relation(remote.location_dest_id)],
        ["usage", "=", "internal"],
        "|",
        ["company_id", "=", false],
        ["company_id", "=", config.companyId],
      ],
      ["company_id", "usage"],
    );
    if (locations.length !== 1)
      throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
  };
  const moveFields = [
    "picking_id",
    "company_id",
    "state",
    "product_id",
    caps.unitField,
    caps.quantityField,
    "product_uom_qty",
    "origin_returned_move_id",
  ];
  const originals = await search(
    "stock.move",
    [
      ["picking_id", "=", request.pickingId],
      ["company_id", "=", config.companyId],
    ],
    moveFields,
  );
  const own = await search(
    "stock.picking",
    [
      ["name", "=", reference],
      ["company_id", "=", config.companyId],
    ],
    pickingFields,
  );
  if (
    own.length > 1 ||
    (progress.remoteId !== null && own[0]?.id !== progress.remoteId)
  )
    throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
  let remote = own[0];
  if (remote) await verifyRemote(remote);
  if (!remote && progress.started)
    throw new AppError("ODOO_RETURN_OUTCOME_UNKNOWN", 503);
  const prior = await search(
    "stock.move",
    [
      [
        "origin_returned_move_id",
        "in",
        request.lines.map((line) => line.moveId),
      ],
      ["company_id", "=", config.companyId],
      ["state", "!=", "cancel"],
    ],
    moveFields,
  );
  const convert = async (
    quantity: string,
    from: number,
    to: number,
  ): Promise<string> => {
    if (from === to) return quantity;
    // Legacy wizard units are product units; newer native returns use move units.
    const uoms = rows(
      await call("uom.uom", "read", [[from, to]], {
        fields: ["factor", "category_id"],
      }),
    );
    const source = uoms.find((row) => row.id === from),
      target = uoms.find((row) => row.id === to);
    if (
      !source ||
      !target ||
      relation(source.category_id) !== relation(target.category_id)
    )
      throw new AppError("ODOO_RETURN_UOM_UNSUPPORTED", 409);
    return convertReturnQuantity(
      quantity,
      {
        factor: String(source.factor),
        categoryId: relation(source.category_id),
      },
      {
        factor: String(target.factor),
        categoryId: relation(target.category_id),
      },
    );
  };
  const verifyAvailable = async () => {
    for (const line of request.lines) {
      const original = originals.find((row) => row.id === line.moveId);
      if (
        !original ||
        original.state !== "done" ||
        original.origin_returned_move_id ||
        relation(original.product_id) !== line.productId ||
        relation(original[caps.unitField]) !== line.uomId
      )
        throw new AppError("ODOO_RETURN_IDENTITY_INVALID", 409);
      const used: string[] = [];
      for (const item of prior.filter(
        (row) =>
          relation(row.origin_returned_move_id) === line.moveId &&
          (!remote || relation(row.picking_id) !== remote.id),
      )) {
        const quantity =
          item.state === "done"
            ? item[caps.quantityField]
            : item.product_uom_qty;
        used.push(
          await convert(
            String(quantity),
            relation(item[caps.unitField]),
            line.uomId,
          ),
        );
      }
      assertReturnAvailable(line.quantity, original[caps.quantityField], used);
    }
  };
  await verifyAvailable();
  const createNative = async () => {
    let wizard: number | null = null;
    if (caps.mode === "wizard") {
      const created = await call("stock.return.picking", "create", [
        { picking_id: request.pickingId },
      ]);
      if (!Number.isSafeInteger(created) || Number(created) < 1)
        throw new AppError("ODOO_INVALID_RESPONSE", 502);
      wizard = Number(created);
      const lines = await search(
        "stock.return.picking.line",
        [["wizard_id", "=", wizard]],
        ["move_id", "product_id", "uom_id", "quantity"],
      );
      const updates: unknown[] = [];
      for (const row of lines) {
        const selected = request.lines.find(
          (line) => line.moveId === relation(row.move_id),
        );
        updates.push([
          1,
          row.id,
          {
            quantity: selected
              ? Number(
                  await convert(
                    selected.quantity,
                    selected.uomId,
                    relation(row.uom_id),
                  ),
                )
              : 0,
          },
        ]);
      }
      if (
        request.lines.some(
          (line) => !lines.some((row) => relation(row.move_id) === line.moveId),
        )
      )
        throw new AppError("ODOO_RETURN_IDENTITY_INVALID", 409);
      await call("stock.return.picking", "write", [
        [wizard],
        { product_return_moves: updates },
      ]);
    }
    await progress.beforeCreate();
    const extra = {
      context: {
        ...context,
        default_name: reference,
        active_model: "stock.picking",
        active_id: request.pickingId,
        active_ids: [request.pickingId],
      },
    };
    const action = (await call(
      caps.mode === "wizard" ? "stock.return.picking" : "stock.picking",
      caps.method,
      [[wizard ?? request.pickingId]],
      extra,
    )) as Row;
    if (
      action.res_model !== "stock.picking" ||
      !Number.isSafeInteger(action.res_id) ||
      Number(action.res_id) < 1
    )
      throw new AppError("ODOO_RETURN_OUTCOME_UNKNOWN", 503);
    return Number(action.res_id);
  };
  if (!remote) {
    const remoteId = await createNative();
    await progress.created(remoteId);
    const created = await search(
      "stock.picking",
      [
        ["id", "=", remoteId],
        ["company_id", "=", config.companyId],
      ],
      pickingFields,
    );
    remote = created[0];
    await verifyRemote(remote);
  } else await progress.created(Number(remote.id));
  let movements = await search(
    "stock.move",
    [
      ["picking_id", "=", remote.id],
      ["company_id", "=", config.companyId],
      ["state", "!=", "cancel"],
    ],
    moveFields,
  );
  const populateNativeDraft = async () => {
    if (
      caps.mode === "picking" &&
      remote.state === "draft" &&
      movements.every((row) => new Decimal(String(row.product_uom_qty)).eq(0))
    ) {
      // Native 20 creates zero-demand draft lines. Only this untouched draft can be populated.
      const edits: unknown[] = [];
      for (const move of movements) {
        const line = request.lines.find(
          (item) => item.moveId === relation(move.origin_returned_move_id),
        );
        if (
          line &&
          (relation(move.product_id) !== line.productId ||
            relation(move[caps.unitField]) !== line.uomId)
        )
          throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
        edits.push(
          line
            ? [1, move.id, { product_uom_qty: Number(line.quantity) }]
            : [2, move.id, 0],
        );
      }
      if (
        request.lines.some(
          (line) =>
            movements.filter(
              (move) => relation(move.origin_returned_move_id) === line.moveId,
            ).length !== 1,
        )
      )
        throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
      await call("stock.picking", "write", [[remote.id], { move_ids: edits }]);
      movements = await search(
        "stock.move",
        [
          ["picking_id", "=", remote.id],
          ["company_id", "=", config.companyId],
          ["state", "!=", "cancel"],
        ],
        moveFields,
      );
    }
  };
  await populateNativeDraft();
  const receipt = async (): Promise<ReturnReceipt> => {
    const lines: ReturnReceipt["lines"] = [];
    for (const move of movements) {
      const originalId = relation(move.origin_returned_move_id),
        wanted = request.lines.find((line) => line.moveId === originalId);
      if (!wanted) throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
      lines.push({
        id: Number(move.id),
        moveId: originalId,
        productId: relation(move.product_id),
        uomId: wanted.uomId,
        quantity: await convert(
          String(move.product_uom_qty),
          relation(move[caps.unitField]),
          wanted.uomId,
        ),
      });
    }
    return {
      id: Number(remote.id),
      name: String(remote.name),
      state: String(remote.state),
      lines,
    };
  };
  assertReturnReceipt(request, await receipt());
  if (remote.state === "draft")
    await call("stock.picking", "action_confirm", [[remote.id]]);
  // Reserve via the native method; never button_validate.
  remote = (
    await search(
      "stock.picking",
      [
        ["id", "=", remote.id],
        ["company_id", "=", config.companyId],
      ],
      pickingFields,
    )
  )[0];
  await verifyRemote(remote);
  if (!["waiting", "confirmed", "assigned"].includes(String(remote?.state)))
    throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
  if (remote.state !== "assigned")
    await call("stock.picking", "action_assign", [[remote.id]]);
  remote = (
    await search(
      "stock.picking",
      [
        ["id", "=", remote.id],
        ["company_id", "=", config.companyId],
      ],
      pickingFields,
    )
  )[0];
  await verifyRemote(remote);
  movements = await search(
    "stock.move",
    [
      ["picking_id", "=", remote.id],
      ["company_id", "=", config.companyId],
      ["state", "!=", "cancel"],
    ],
    moveFields,
  );
  const result = await receipt();
  assertReturnReceipt(request, result);
  return result;
}
