import { loginMobile, logoutMobile } from "@/core/driver-mobile-auth";
import { endpoint, json, database } from "@/server/http";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";

export function POST(request: Request) {
  return endpoint(async () => {
    const { pool } = await database();
    return json(await loginMobile(pool, await mobileBody(request)));
  });
}

export function DELETE(request: Request) {
  return endpoint(async () => {
    const { pool } = await mobilePrincipal(request);
    await logoutMobile(pool, request.headers.get("authorization"));
    return json({ ok: true });
  });
}
