import { body, endpoint, json, principal } from "@/server/http";
import { assertOrderSource, moveShipment, orderBoard, persistImportPage } from "@/core/orders";
import { readFulfilledPage } from "@/core/odoo";
import { importRange, integer } from "@/core/orders-validation";
import { readOdooConfig } from "@/core/config";
import { AppError } from "@/core/errors";
type Context = { params: Promise<{ id: string }> };
export function GET(_request: Request, ctx: Context) {
  return endpoint(async () => json(await orderBoard((await principal()).pool, (await ctx.params).id)));
}
export function POST(request: Request, ctx: Context) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user, config } = await principal();
    const id = (await ctx.params).id;
    const range = importRange(input, config.timezone);
    const board = await orderBoard(pool, id);
    if (range.to > board.plan.service_date) throw new AppError("INVALID_DATE");
    if (!board.vehicles.length) throw new AppError("SELECT_VEHICLES");
    const odoo = readOdooConfig();
    await assertOrderSource(pool, odoo.fingerprint);
    const page = await readFulfilledPage(range, integer(input.cursor ?? 0), input.ceiling === undefined ? undefined : integer(input.ceiling), odoo);
    return json(await persistImportPage(pool, user.id, id, page));
  });
}
export function PATCH(request: Request, ctx: Context) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    const id = (await ctx.params).id;
    await moveShipment(pool, user.id, id, input);
    return json(await orderBoard(pool, id));
  });
}
