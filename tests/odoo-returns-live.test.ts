import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readOdooConfig } from "../src/core/config";
import { odooRpc } from "../src/core/odoo-rpc";
import {
  inspectOdooReturnContract,
  prepareOdooReturn,
} from "../src/core/odoo-returns";
import {
  returnReference,
  type ReturnRequest,
} from "../src/core/odoo-return-policy";
import { AppError } from "../src/core/errors";
import { writeFile } from "node:fs/promises";

it.skipIf(!process.env.RUTAS_TEST_RETURN_PICKING)(
  "real develop Odoo: native partial return, lost response recovery, duplicate constraint and manual validation",
  async () => {
    const config = readOdooConfig();
    if (
      new URL(config.url).hostname !== "developfive.odoo.com" ||
      config.database !== "developfive"
    )
      throw Error("DEVELOP_SCOPE_MISMATCH");
    const uid = await odooRpc(config, "common", "authenticate", [
      config.database,
      config.username,
      config.credential,
      {},
    ]);
    const call = async (
      model: string,
      method: string,
      args: unknown[],
      extra: Record<string, unknown> = {},
    ) =>
      odooRpc(config, "object", "execute_kw", [
        config.database,
        uid,
        config.credential,
        model,
        method,
        args,
        { context: { allowed_company_ids: [config.companyId] }, ...extra },
      ]);
    const caps = await inspectOdooReturnContract(config);
    const original = (
      (await call(
        "stock.picking",
        "read",
        [[Number(process.env.RUTAS_TEST_RETURN_PICKING)]],
        { fields: ["sale_id", "partner_id", "move_ids", "state"] },
      )) as {
        id: number;
        sale_id: [number, string];
        partner_id: [number, string];
        move_ids: number[];
        state: string;
      }[]
    )[0];
    expect(original.state).toBe("done");
    const sourceLines = (await call("stock.move", "read", [original.move_ids], {
      fields: ["product_id", caps.unitField, caps.quantityField, "state"],
    })) as Record<string, unknown>[];
    const line = sourceLines.find(
      (item) => item.state === "done" && Number(item[caps.quantityField]) >= 1,
    )!;
    const input: ReturnRequest = {
      id: randomUUID(),
      source: config.fingerprint,
      companyId: config.companyId,
      pickingId: original.id,
      orderId: original.sale_id[0],
      partnerId: original.partner_id[0],
      lines: [
        {
          moveId: Number(line.id),
          productId: (line.product_id as [number, string])[0],
          uomId: (line[caps.unitField] as [number, string])[0],
          quantity: "0.25",
          incidentIds: [randomUUID()],
        },
      ],
    };
    const startedAt = performance.now();
    let started = false;
    // Fault injection after a REAL remote commit, before saving its identity locally. No fake API response.
    await expect(
      prepareOdooReturn(
        input,
        {
          started,
          remoteId: null,
          beforeCreate: async () => {
            started = true;
          },
          created: async () => {
            throw new AppError("ODOO_UNAVAILABLE", 502);
          },
        },
        config,
      ),
    ).rejects.toThrow("ODOO_UNAVAILABLE");
    expect(started).toBe(true);
    let remoteId: number | null = null;
    const progress = {
      started: true,
      remoteId,
      beforeCreate: async () => {
        throw Error("DUPLICATE_CREATION");
      },
      created: async (id: number) => {
        remoteId = id;
      },
    };
    const receipt = await prepareOdooReturn(input, progress, config);
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0].quantity).toBe("0.25");
    expect(receipt.state).not.toBe("done");
    const again = await prepareOdooReturn(
      input,
      { ...progress, remoteId },
      config,
    );
    expect(again.id).toBe(receipt.id);
    const exact = (await call(
      "stock.picking",
      "search_read",
      [
        [
          ["name", "=", returnReference(input.id)],
          ["company_id", "=", config.companyId],
        ],
      ],
      { fields: ["name", "state", "return_id"] },
    )) as unknown[];
    expect(exact).toHaveLength(1);
    if (caps.mode === "picking")
      await expect(
        call("stock.picking", "action_return", [[original.id]], {
          context: {
            allowed_company_ids: [config.companyId],
            default_name: returnReference(input.id),
          },
        }),
      ).rejects.toMatchObject({ code: "ODOO_DENIED" });
    await expect(
      prepareOdooReturn(
        { ...input, id: randomUUID() },
        { ...progress, remoteId: null },
        config,
      ),
    ).rejects.toMatchObject({ code: "ODOO_RETURN_OUTCOME_UNKNOWN" });
    await expect(
      prepareOdooReturn({ ...input, source: "other" }, progress, config),
    ).rejects.toMatchObject({ code: "ODOO_RETURN_SCOPE_CHANGED" });
    await writeFile(
      ".local/odoo-return-live-evidence.json",
      JSON.stringify(
        {
          mode: caps.mode,
          method: caps.method,
          originalPicking: original.id,
          receipt,
          lostResponseRecovered: true,
          remoteDuplicateRejected: caps.mode === "picking",
          durationMs: Math.ceil(performance.now() - startedAt),
          validation: "manual, not executed",
        },
        null,
        2,
      ),
    );
  },
  120000,
);
