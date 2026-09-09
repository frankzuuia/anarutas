import { database, endpoint, json } from "@/server/http";
export const dynamic = "force-dynamic";
export function GET() {
  return endpoint(async () => {
    await database();
    return json({ status: "ready" });
  });
}
