import { body, endpoint, json, principal } from "@/server/http";
import {
  prepareConfirmation,
  persistCandidateSelection,
} from "@/core/order-candidates";
import { readRoutingCandidates } from "@/core/odoo";
import { readOdooConfig } from "@/core/config";
import { candidateConfig } from "@/core/order-candidates-config";
import { throttle } from "@/core/auth";

type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return endpoint(async (requestId) => {
    const input = await body(request, 1024 * 1024);
    const { pool, user } = await principal();
    const id = (await context.params).id;
    await throttle(
      pool,
      `order-confirm:${user.id}`,
      candidateConfig().requestsPerMinute,
    );
    const odoo = readOdooConfig();
    const prepared = await prepareConfirmation(
      pool,
      user.id,
      id,
      odoo.fingerprint,
      input,
    );
    if (prepared.receipt) return json(prepared.receipt);
    const range = prepared.row.query_range;
    const started = performance.now();
    const fresh = await readRoutingCandidates(
      range,
      prepared.selected.map((c) => c.shipment),
      odoo,
    );
    return json(
      await persistCandidateSelection(
        pool,
        user.id,
        id,
        odoo.fingerprint,
        input,
        fresh,
        { requestId, odooMs: Math.round(performance.now() - started) },
      ),
    );
  });
}
