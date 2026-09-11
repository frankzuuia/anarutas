import {
  getGoogleConsumptionState,
  refreshGoogleConsumption,
} from "@/core/google-consumption";
import { body, endpoint, json, principal } from "@/server/http";

export function GET() {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(await getGoogleConsumptionState(pool));
  });
}

export function POST(request: Request) {
  return endpoint(async () => {
    await body(request);
    const { pool, user } = await principal();
    return json(await refreshGoogleConsumption(pool, user.id));
  });
}
