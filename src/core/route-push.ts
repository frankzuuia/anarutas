import type { Pool } from "pg";
import { GoogleAuth } from "google-auth-library";
import { AppError } from "./errors";
import { decodeGoogleServiceAccount } from "./routing-config";

type PushKind = "published" | "withdrawn";
type Delivery = {
  id: string;
  device_id: string;
  driver_id: string;
  plan_id: string;
  vehicle_id: string;
  revision: number;
  kind: PushKind;
  attempts: number;
};
type Recipient = { fid: string | null; current_driver_id: string | null; current_revision: number | null; revoked_at: Date | null };

export function readFirebasePushConfig(env: Record<string, string | undefined> = process.env) {
  const projectId = env.RUTAS_FIREBASE_PROJECT_ID?.trim();
  const encoded = env.RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!projectId || !encoded) throw new AppError("PUSH_CONFIG_MISSING", 503);
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId))
    throw new AppError("PUSH_CONFIG_INVALID", 503);
  const credentials = decodeGoogleServiceAccount(encoded, "PUSH_CONFIG_INVALID");
  if (credentials.project_id !== projectId) throw new AppError("PUSH_CONFIG_INVALID", 503);
  return { projectId, credentials };
}

export function shouldSendRoutePush(delivery: Pick<Delivery, "driver_id" | "revision" | "kind">, recipient: Recipient) {
  if (!recipient.fid) return false;
  if (delivery.kind === "published")
    return recipient.current_driver_id === delivery.driver_id &&
      recipient.current_revision === delivery.revision && recipient.revoked_at === null;
  return recipient.current_driver_id !== delivery.driver_id || recipient.revoked_at !== null;
}

export function routePushMessage(delivery: Delivery, fid: string) {
  return {
    message: {
      fid,
      notification: delivery.kind === "published"
        ? { title: "Nueva ruta disponible", body: "Tu ruta ya está lista. Abre Ana Rutas para verla." }
        : { title: "Ruta retirada", body: "Administración retiró tu ruta. Abre Ana Rutas para ver tu jornada." },
      data: {
        event: delivery.kind === "published" ? "route_published" : "route_withdrawn",
        planId: delivery.plan_id,
        revision: String(delivery.revision),
      },
      android: { priority: "HIGH", ttl: "14400s", notification: { channel_id: "routes" } },
    },
  };
}

export function firebasePushFailure(status: number, code: string) {
  if (code === "UNREGISTERED") return "invalid_fid";
  if (status === 429 || status >= 500 || status === 401 || status === 403)
    return "retry";
  return "discard";
}

export async function claimRoutePush(pool: Pool, batchSize = 20) {
  await pool.query(
    `UPDATE route_mobile_push_deliveries SET discarded_at=now(),claimed_until=NULL,last_error='EXPIRED'
      WHERE delivered_at IS NULL AND discarded_at IS NULL AND expires_at<=now()`,
  );
  const { rows } = await pool.query(
    `UPDATE route_mobile_push_deliveries q SET
       claimed_until=now()+interval '1 minute', attempts=q.attempts+1
      FROM (
        SELECT id FROM route_mobile_push_deliveries
         WHERE delivered_at IS NULL AND discarded_at IS NULL AND expires_at>now()
           AND next_attempt_at<=now()
           AND (claimed_until IS NULL OR claimed_until<now())
         ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) due WHERE q.id=due.id
      RETURNING q.id::text,q.device_id,q.driver_id,q.plan_id,q.vehicle_id,
                q.revision,q.kind,q.attempts`,
    [batchSize],
  );
  return rows as Delivery[];
}

async function recipientForDelivery(pool: Pool, delivery: Delivery) {
  const { rows } = await pool.query(
    `SELECT r.fid,p.driver_id AS current_driver_id,p.revision AS current_revision,p.revoked_at
       FROM route_mobile_push_deliveries q
       LEFT JOIN route_mobile_push_registrations r
         ON r.device_id=q.device_id AND r.driver_id=q.driver_id AND r.disabled_at IS NULL
       LEFT JOIN route_driver_mobile_devices d
         ON d.id=r.device_id AND d.revoked_at IS NULL
       LEFT JOIN route_driver_mobile_access a
         ON a.driver_id=r.driver_id AND a.enabled
       LEFT JOIN route_drivers f ON f.id=r.driver_id AND f.active
       LEFT JOIN route_plan_publications p
         ON p.plan_id=q.plan_id AND p.vehicle_id=q.vehicle_id
      WHERE q.id=$1 AND r.fid IS NOT NULL AND d.id IS NOT NULL
        AND a.driver_id IS NOT NULL AND f.id IS NOT NULL`,
    [delivery.id],
  );
  return (rows[0] ?? { fid: null, current_driver_id: null, current_revision: null, revoked_at: null }) as Recipient;
}

async function completeRoutePush(pool: Pool, delivery: Delivery, state: "delivered" | "discarded" | "retry", errorCode?: string) {
  const nextSeconds = Math.min(900, 5 * 2 ** Math.min(delivery.attempts, 7));
  await pool.query(
    `UPDATE route_mobile_push_deliveries SET
       delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END,
       discarded_at=CASE WHEN $2='discarded' OR expires_at<=now() THEN now() ELSE discarded_at END,
       next_attempt_at=CASE WHEN $2='retry' THEN now()+($3::integer*interval '1 second') ELSE next_attempt_at END,
       claimed_until=NULL,last_error=$4
      WHERE id=$1 AND delivered_at IS NULL AND discarded_at IS NULL`,
    [delivery.id, state, nextSeconds, errorCode ?? null],
  );
}

export async function dispatchRoutePushBatch(pool: Pool, config = readFirebasePushConfig()) {
  const auth = new GoogleAuth({
    credentials: config.credentials,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const deliveries = await claimRoutePush(pool);
  for (const delivery of deliveries) {
    const recipient = await recipientForDelivery(pool, delivery);
    if (!shouldSendRoutePush(delivery, recipient)) {
      await completeRoutePush(pool, delivery, "discarded", "STALE_OR_UNAUTHORIZED");
      continue;
    }
    try {
      const token = await auth.getAccessToken();
      if (!token) throw new Error("OAUTH_UNAVAILABLE");
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(routePushMessage(delivery, recipient.fid!)),
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        await completeRoutePush(pool, delivery, "delivered");
        continue;
      }
      const body = await response.text();
      const code = ((): string => {
        try {
          const parsed = JSON.parse(body) as { error?: { status?: string; details?: { errorCode?: string }[] } };
          return parsed.error?.details?.find((item) => item.errorCode)?.errorCode ?? parsed.error?.status ?? "FCM_ERROR";
        } catch { return "FCM_ERROR"; }
      })();
      const outcome = firebasePushFailure(response.status, code);
      if (outcome === "invalid_fid")
        await pool.query("UPDATE route_mobile_push_registrations SET disabled_at=now() WHERE device_id=$1 AND fid=$2", [delivery.device_id, recipient.fid]);
      await completeRoutePush(pool, delivery, outcome === "retry" ? "retry" : "discarded", code);
      console.warn(JSON.stringify({ event: "route_push.send_failed", status: response.status, code, outcome }));
    } catch {
      await completeRoutePush(pool, delivery, "retry", "TRANSPORT_UNAVAILABLE");
      console.warn(JSON.stringify({ event: "route_push.transport_unavailable" }));
    }
  }
  return deliveries.length;
}
