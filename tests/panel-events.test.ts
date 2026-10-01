import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHook } from "node:async_hooks";
import { Pool } from "pg";
import { startPostgres } from "./helpers/postgres";
import { subscribePanelChanges } from "../src/core/panel-events";
import { isExpiredPanelSession, panelEventStream } from "../src/core/panel-event-stream";
import { audit, migrate, transaction } from "../src/core/database";
import { bootstrap, login, logout } from "../src/core/auth";
import { tokenHash } from "../src/core/crypto";
import { AppError } from "../src/core/errors";

let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
const password = randomUUID();
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Realtime QA",
      login: "live-qa",
      password,
    })
  ).id;
});
afterAll(async () => {
  await db.close();
});

async function event(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel();
          reject(new Error("EVENT_TIMEOUT"));
        }, 5000);
      }),
    ]);
    return chunk.done ? "closed" : new TextDecoder().decode(chunk.value);
  } finally {
    clearTimeout(timer);
  }
}

describe("panel events with real PostgreSQL", () => {
  it("migrates once and covers all existing operational tables, not session touches", async () => {
    await migrate(db.pool, db.config.instanceId);
    const { rows } = await db.pool.query(
      "SELECT event_object_table FROM information_schema.triggers WHERE trigger_name='panel_changed'",
    );
    const tables = new Set(rows.map((r) => r.event_object_table));
    expect(tables.size).toBe(27);
    for (const name of [
      "route_plans",
      "route_plan_publications",
      "route_unit_photos",
      "route_audit",
      "route_driver_mobile_audit",
      "route_customers",
      "route_vehicles",
      "route_driver_executions",
      "route_driver_execution_orders",
      "route_driver_service_incidents",
      "route_product_incidents",
      "route_order_payments",
      "route_settlement_requests",
      "route_driver_work_completions",
      "route_driver_incident_orders",
      "route_driver_incident_evidence",
      "route_driver_stop_events",
      "route_driver_operation_settings",
    ])
      expect(tables.has(name)).toBe(true);
    expect(tables.has("route_sessions")).toBe(false);
  });

  it("shares one listener, emits only after commit and coalesces repeated statements", async () => {
    const first: string[] = [],
      second: string[] = [];
    const stops = await Promise.all([
      subscribePanelChanges(db.pool, (value) => first.push(value)),
      subscribePanelChanges(db.pool, (value) => second.push(value)),
    ]);
    try {
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE query='LISTEN ana_rutas_panel'",
          )
        ).rows[0].n,
      ).toBe(1);
      await transaction(db.pool, async (sql) => {
        await audit(sql, actor, "qa.changed");
        await audit(sql, actor, "qa.changed.again");
        await delay(100);
        expect(first).toEqual([]);
      });
      await expect.poll(() => first).toEqual(["change"]);
      expect(second).toEqual(["change"]);
      await expect(
        transaction(db.pool, async (sql) => {
          await audit(sql, actor, "qa.rollback");
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      await delay(100);
      expect(first).toEqual(["change"]);
    } finally {
      stops.forEach((stop) => stop());
    }
  });

  it("ignores foreign channels/payloads and releases listeners idempotently", async () => {
    const pool = new Pool({ connectionString: db.config.databaseUrl, max: 1 });
    const received: string[] = [];
    let stop: (() => void) | undefined;
    try {
      const borrowed = await pool.connect();
      try {
        await borrowed.query("LISTEN ana_rutas_other");
      } finally {
        borrowed.release();
      }
      stop = await subscribePanelChanges(pool, (value) => received.push(value));
      await db.pool.query(
        "SELECT pg_notify('ana_rutas_other','changed'),pg_notify('ana_rutas_panel','private')",
      );
      await delay(100);
      expect(received).toEqual([]);
      await db.pool.query("SELECT pg_notify('ana_rutas_panel','changed')");
      await expect.poll(() => received).toEqual(["change"]);
    } finally {
      stop?.();
      stop?.();
      await pool.end();
    }
    await expect.poll(async () => (
      await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE query='LISTEN ana_rutas_panel'")
    ).rows[0].n).toBe(0);
  });

  it("discards a failed LISTEN connection and reconnects on a fresh PostgreSQL session", async () => {
    const pool = new Pool({ connectionString: db.config.databaseUrl, max: 1 });
    let stop: (() => void) | undefined;
    try {
      const borrowed = await pool.connect();
      await borrowed.query("BEGIN");
      await expect(borrowed.query("SELECT 1/0")).rejects.toMatchObject({ code: "22012" });
      borrowed.release();
      await expect(subscribePanelChanges(pool, () => {})).rejects.toMatchObject({ code: "25P02" });
      const received: string[] = [];
      stop = await subscribePanelChanges(pool, value => received.push(value));
      await db.pool.query("SELECT pg_notify('ana_rutas_panel','changed')");
      await expect.poll(() => received).toEqual(["change"]);
    } finally {
      stop?.();
      await pool.end();
    }
  });

  it("classifies only an AppError 401 as an expired panel session", () => {
    expect(isExpiredPanelSession(new AppError("UNAUTHENTICATED", 401))).toBe(true);
    expect(isExpiredPanelSession(new AppError("NOT_ALLOWED", 403))).toBe(false);
    expect(isExpiredPanelSession(Object.assign(new Error("database"), { status: 401 }))).toBe(false);
  });

  it("disconnects subscribers on backend termination and permits a clean reconnect", async () => {
    const received: string[] = [];
    const stop = await subscribePanelChanges(db.pool, (value) =>
      received.push(value),
    );
    await db.pool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query='LISTEN ana_rutas_panel'",
    );
    await expect.poll(() => received).toContain("disconnected");
    stop();
    const again: string[] = [];
    const stopAgain = await subscribePanelChanges(db.pool, (value) =>
      again.push(value),
    );
    try {
      await audit(db.pool, actor, "qa.reconnected");
      await expect.poll(() => again).toEqual(["change"]);
    } finally {
      stopAgain();
    }
  });

  it("sends a reset then changes without leaking fields; keeps idle but never extends absolute expiry", async () => {
    const { token } = await login(db.pool, db.config, {
      login: "live-qa",
      password,
    });
    const signal = new AbortController();
    const reader = panelEventStream(
      db.pool,
      { ...db.config, panelHeartbeatSeconds: 1 },
      token,
      signal.signal,
    ).getReader();
    try {
      expect(await event(reader)).toBe(
        'event: reset\ndata: {"heartbeatSeconds":1}\n\n',
      );
      await db.pool.query(
        "UPDATE route_sessions SET idle_expires_at=now()+interval '2 seconds' WHERE token_hash=$1",
        [tokenHash(token)],
      );
      const before = (
        await db.pool.query(
          "SELECT expires_at,idle_expires_at FROM route_sessions WHERE token_hash=$1",
          [tokenHash(token)],
        )
      ).rows[0];
      expect(await event(reader)).toBe("event: heartbeat\ndata: {}\n\n");
      const after = (
        await db.pool.query(
          "SELECT expires_at,idle_expires_at FROM route_sessions WHERE token_hash=$1",
          [tokenHash(token)],
        )
      ).rows[0];
      expect(after.idle_expires_at.getTime()).toBeGreaterThan(
        before.idle_expires_at.getTime(),
      );
      expect(after.expires_at).toEqual(before.expires_at);
      await audit(db.pool, actor, "qa.secret", null, {
        token: "must not leak",
      });
      expect(await event(reader)).toBe("event: change\ndata: {}\n\n");
      expect(await event(reader)).toBe("event: heartbeat\ndata: {}\n\n");
      await logout(db.pool, actor, token);
      expect(await event(reader)).toBe("event: session-expired\ndata: {}\n\n");
      expect(await event(reader)).toBe("closed");
    } finally {
      signal.abort();
    }
  });

  it("denies invalid tokens and absolute expiry even while the panel remains connected", async () => {
    const bad = panelEventStream(
      db.pool,
      db.config,
      "invalid",
      new AbortController().signal,
    ).getReader();
    expect(await event(bad)).toContain("session-expired");
    expect(await event(bad)).toBe("closed");
    const { token } = await login(db.pool, db.config, {
      login: "live-qa",
      password,
    });
    const signal = new AbortController();
    const reader = panelEventStream(
      db.pool,
      { ...db.config, panelHeartbeatSeconds: 1 },
      token,
      signal.signal,
    ).getReader();
    try {
      expect(await event(reader)).toContain("reset");
      await db.pool.query(
        "UPDATE route_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [tokenHash(token)],
      );
      expect(await event(reader)).toContain("session-expired");
      expect(await event(reader)).toBe("closed");
    } finally {
      signal.abort();
    }
  });

  it("cleans up aborted, cancelled and slow streams without unbounded queues", async () => {
    const { token } = await login(db.pool, db.config, {
      login: "live-qa",
      password,
    });
    const signal = new AbortController();
    signal.abort();
    const early = panelEventStream(
      db.pool,
      db.config,
      token,
      signal.signal,
    ).getReader();
    expect(await event(early)).toBe("closed");
    const cancelled = panelEventStream(
      db.pool,
      db.config,
      token,
      new AbortController().signal,
    ).getReader();
    expect(await event(cancelled)).toContain("reset");
    await cancelled.cancel();
    const slow = panelEventStream(
      db.pool,
      { ...db.config, panelHeartbeatSeconds: 1 },
      token,
      new AbortController().signal,
    ).getReader();
    await delay(1300);
    expect(await event(slow)).toContain("reset");
    expect(await event(slow)).toBe("closed");
  });

  it("closes while initial authentication waits on a real PostgreSQL lock", async () => {
    const { token } = await login(db.pool, db.config, {
      login: "live-qa",
      password,
    });
    const lock = await db.pool.connect();
    const signal = new AbortController();
    const healthySignal = new AbortController();
    const timers = new Map<number, NodeJS.Timeout>();
    // Observe real Node timers, including an interval created after abort.
    const resources = createHook({
      init(id, type, _trigger, resource) {
        if (type === "Timeout" && new Error().stack?.includes("panel-event-stream.ts"))
          timers.set(id, resource as NodeJS.Timeout);
      },
      destroy(id) { timers.delete(id); },
    }).enable();
    try {
      await lock.query("BEGIN");
      await lock.query(
        "UPDATE route_sessions SET idle_expires_at=idle_expires_at WHERE token_hash=$1",
        [tokenHash(token)],
      );
      const reader = panelEventStream(
        db.pool,
        { ...db.config, panelHeartbeatSeconds: 1 },
        token,
        signal.signal,
      ).getReader();
      await expect.poll(async () => (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE query LIKE 'UPDATE route_sessions SET idle_expires_at=LEAST%' AND wait_event_type='Lock'",
        )
      ).rows[0].n).toBe(1);
      signal.abort();
      expect(await event(reader)).toBe("closed");
      await lock.query("ROLLBACK");
      await expect.poll(async () => (
        await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE query='LISTEN ana_rutas_panel'")
      ).rows[0].n).toBe(0);
      await delay(150);
      expect(timers.size).toBe(0);
      // Prove the observer detects a live heartbeat and its cleanup as well.
      const healthy = panelEventStream(
        db.pool,
        { ...db.config, panelHeartbeatSeconds: 1 },
        token,
        healthySignal.signal,
      ).getReader();
      expect(await event(healthy)).toContain("reset");
      expect(timers.size).toBeGreaterThan(0);
      healthySignal.abort();
      expect(await event(healthy)).toBe("closed");
      await expect.poll(() => timers.size).toBe(0);
    } finally {
      signal.abort();
      healthySignal.abort();
      await lock.query("ROLLBACK");
      lock.release();
      resources.disable();
      for (const timer of timers.values()) clearInterval(timer);
    }
  });

  it("does not accumulate concurrent authentication queries behind a database lock", async () => {
    await db.pool.query("DELETE FROM auth_attempts");
    const { token } = await login(db.pool, db.config, {
      login: "live-qa",
      password,
    });
    const signal = new AbortController();
    const reader = panelEventStream(
      db.pool,
      { ...db.config, panelHeartbeatSeconds: 1 },
      token,
      signal.signal,
    ).getReader();
    const lock = await db.pool.connect();
    try {
      expect(await event(reader)).toContain("reset");
      await lock.query("BEGIN");
      await lock.query(
        "UPDATE route_sessions SET idle_expires_at=idle_expires_at WHERE token_hash=$1",
        [tokenHash(token)],
      );
      const waiting = async () =>
        (
          await db.pool.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE query LIKE 'UPDATE route_sessions SET idle_expires_at=LEAST%' AND wait_event_type='Lock'",
          )
        ).rows[0].n;
      await expect.poll(waiting, { timeout: 3000 }).toBe(1);
      await delay(2100);
      expect(await waiting()).toBe(1);
      await lock.query("ROLLBACK");
      expect(await event(reader)).toContain("heartbeat");
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
      signal.abort();
    }
  });

  it("treats actual database failures as reconnectable, not as invalid credentials", async () => {
    await db.pool.query("DELETE FROM auth_attempts");
    const { token } = await login(db.pool, db.config, {
      login: "live-qa",
      password,
    });
    // Real database fault, confined to this isolated QA database. No mocked pool/auth.
    await db.pool.query(
      "ALTER TABLE route_sessions RENAME TO qa_unavailable_sessions",
    );
    try {
      const initial = panelEventStream(
        db.pool,
        db.config,
        token,
        new AbortController().signal,
      ).getReader();
      expect(await event(initial)).toBe("closed");
    } finally {
      await db.pool.query(
        "ALTER TABLE qa_unavailable_sessions RENAME TO route_sessions",
      );
    }
    const signal = new AbortController();
    const active = panelEventStream(
      db.pool,
      { ...db.config, panelHeartbeatSeconds: 1 },
      token,
      signal.signal,
    ).getReader();
    expect(await event(active)).toContain("reset");
    await db.pool.query(
      "ALTER TABLE route_sessions RENAME TO qa_unavailable_sessions",
    );
    try {
      expect(await event(active)).toBe("closed");
    } finally {
      signal.abort();
      await db.pool.query(
        "ALTER TABLE qa_unavailable_sessions RENAME TO route_sessions",
      );
    }
  });
});
