import { createMobileActivation } from "@/core/driver-mobile-auth";
import { body, endpoint, json, principal } from "@/server/http";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    const { id } = await context.params;
    const input = await body(request);
    return json(
      await createMobileActivation(
        pool,
        user.id,
        id,
        input.expectedMobileVersion,
      ),
    );
  });
}
