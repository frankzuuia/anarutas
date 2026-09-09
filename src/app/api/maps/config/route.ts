import { endpoint, json, principal } from "@/server/http";
import { readMapConfig } from "@/core/map-config";
export function GET() {
  return endpoint(async () => {
    await principal();
    return json(readMapConfig());
  });
}
