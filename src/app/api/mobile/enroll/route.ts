import { enrollMobileDevice } from "@/core/driver-mobile-auth";
import { endpoint, json, database } from "@/server/http";
import { mobileBody } from "@/server/driver-mobile-http";

export function POST(request: Request) {
  return endpoint(async () => {
    const { pool } = await database();
    return json(await enrollMobileDevice(pool, await mobileBody(request)), 201);
  });
}
