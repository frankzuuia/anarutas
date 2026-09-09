import {
  assertOrderSource,
  orderBoard,
  persistImportPage,
} from "@/core/orders";
import { readFulfilledByOrderNames } from "@/core/odoo";
import { readOdooConfig } from "@/core/config";
import { AppError } from "@/core/errors";
import { body, endpoint, json, principal } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function POST(request: Request, ctx: Context) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    const id = (await ctx.params).id;
    const board = await orderBoard(pool, id);
    if (!board.vehicles.length) throw new AppError("SELECT_VEHICLES");
    const odoo = readOdooConfig();
    await assertOrderSource(pool, odoo.fingerprint);
    const page = await readFulfilledByOrderNames(input.orderNames, odoo);
    return json(await persistImportPage(pool, user.id, id, page));
  });
}
