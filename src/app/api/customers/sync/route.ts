import { assertOrderSource } from "@/core/orders";
import { readOdooConfig } from "@/core/config";
import { persistCustomerPage } from "@/core/customers";
import { readCustomerPage } from "@/core/odoo";
import { integer } from "@/core/orders-validation";
import { body, endpoint, json, principal } from "@/server/http";

export function POST(request: Request) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    const config = readOdooConfig();
    await assertOrderSource(pool, config.fingerprint);
    const page = await readCustomerPage(
      integer(input.cursor ?? 0),
      input.ceiling === undefined ? undefined : integer(input.ceiling),
      config,
    );
    return json(await persistCustomerPage(pool, user.id, page));
  });
}
