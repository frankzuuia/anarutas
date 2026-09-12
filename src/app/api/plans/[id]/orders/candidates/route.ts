import { body, endpoint, json, principal } from "@/server/http";
import {
  candidatePreflight,
  createCandidateBatch,
} from "@/core/order-candidates";
import { readRoutingCandidates } from "@/core/odoo";
import { readOdooConfig } from "@/core/config";
import { candidateConfig } from "@/core/order-candidates-config";
import { throttle } from "@/core/auth";

type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return endpoint(async (requestId) => {
    const input = await body(request);
    const { pool, user, config } = await principal();
    const id = (await context.params).id;
    await throttle(
      pool,
      `order-preview:${user.id}`,
      candidateConfig().requestsPerMinute,
    );
    const odoo = readOdooConfig();
    const { range } = await candidatePreflight(
      pool,
      id,
      input,
      config.timezone,
      odoo.fingerprint,
    );
    const started = performance.now();
    const shipments = await readRoutingCandidates(range, undefined, odoo);
    return json(
      await createCandidateBatch(
        pool,
        user.id,
        id,
        input,
        config.timezone,
        odoo.fingerprint,
        shipments,
        { requestId, odooMs: Math.round(performance.now() - started) },
      ),
    );
  });
}
