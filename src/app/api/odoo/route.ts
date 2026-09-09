import { diagnoseOdoo, odooPublicStatus } from "@/core/odoo";
import { audit } from "@/core/database";
import { throttle } from "@/core/auth";
import { body, endpoint, json, principal } from "@/server/http";
export function GET() {
  return endpoint(async () => {
    await principal();
    return json(odooPublicStatus());
  });
}
export function POST(request: Request) {
  return endpoint(async () => {
    await body(request);
    const { pool, user } = await principal();
    await throttle(pool, "odoo:diagnose", 4);
    const result = await diagnoseOdoo();
    await audit(pool, user.id, "odoo.connection.checked", null, {
      fingerprint: result.fingerprint,
      companyId: result.companyId,
    });
    return json(result);
  });
}
