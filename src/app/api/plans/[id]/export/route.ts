import { planWorkbook, safeFilePart } from "@/core/excel";
import { orderBoard } from "@/core/orders";
import { getPlanOptimization } from "@/core/route-optimization";
import { endpoint, principal } from "@/server/http";
import { xlsx } from "@/server/xlsx";

type Context = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    const { pool, config } = await principal();
    const id = (await context.params).id;
    const [board, optimization] = await Promise.all([
      orderBoard(pool, id),
      getPlanOptimization(pool, id),
    ]);
    return xlsx(
      await planWorkbook(board, optimization, config.timezone),
      `ana-rutas-${safeFilePart(board.plan.label)}-${board.plan.service_date}.xlsx`,
    );
  });
}
