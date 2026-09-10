import { planWorkbook, safeFilePart } from "@/core/excel";
import { orderBoard } from "@/core/orders";
import { endpoint, principal } from "@/server/http";
import { xlsx } from "@/server/xlsx";

type Context = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    const { pool } = await principal();
    const board = await orderBoard(pool, (await context.params).id);
    return xlsx(
      await planWorkbook(board),
      `ana-rutas-${safeFilePart(board.plan.label)}-${board.plan.service_date}.xlsx`,
    );
  });
}
