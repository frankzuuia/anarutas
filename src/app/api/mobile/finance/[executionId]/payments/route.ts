import { endpoint, json, database } from "@/server/http";
import { mobileBody } from "@/server/driver-mobile-http";
import { confirmOrderPayment } from "@/core/payments";
export function POST(
  request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  return endpoint(async () => {
    const input = await mobileBody(request);
    const { pool, config } = await database();
    return json(
      await confirmOrderPayment(
        pool,
        request.headers.get("authorization"),
        (await context.params).executionId,
        input,
        config.timezone,
      ),
    );
  });
}
