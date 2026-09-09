import { json } from "@/server/http";
export function GET() {
  return json({ status: "alive" });
}
