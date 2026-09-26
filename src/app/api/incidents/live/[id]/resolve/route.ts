import { resolveLiveIncident } from "@/core/driver-live-incidents";
import { tryCleanIncidentEvidence } from "@/core/driver-incident-evidence";
import { body, endpoint, json, principal } from "@/server/http";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    const result = await resolveLiveIncident(pool, user.id, (await context.params).id, await body(request));
    await tryCleanIncidentEvidence(pool);
    return json(result);
  });
}
