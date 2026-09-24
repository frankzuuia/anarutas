import { registerMobilePush } from "@/core/route-push-registration";
import { endpoint, json } from "@/server/http";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";

export function POST(request: Request) {
  return endpoint(async () => {
    const { pool, driver } = await mobilePrincipal(request);
    const input = await mobileBody(request, 512);
    return json(await registerMobilePush(pool, driver, input.fid, request.headers.get("authorization")));
  });
}
