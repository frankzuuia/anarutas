import {
  manualRecalculationStatus,
  requestManualRecalculation,
} from "@/core/route-recalculation";
import { body, endpoint, json, principal } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(
      await manualRecalculationStatus(pool, (await context.params).id),
    );
  });
}

export function POST(request: Request, context: Context) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user, config } = await principal();
    return json(
      await requestManualRecalculation(
        pool,
        user.id,
        (await context.params).id,
        input,
        config.recalculationQuietSeconds,
      ),
      202,
    );
  });
}
