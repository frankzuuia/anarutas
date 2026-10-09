import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { executionFixture } from "../helpers/driver-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { readDriverExecution } from "../../src/core/driver-execution-read";
import { executeStopCommand } from "../../src/core/driver-stop-command";
import { reportProductIncident } from "../../src/core/product-incidents";

let f: Awaited<ReturnType<typeof executionFixture>>;
let server: ChildProcess;
let origin: string;
const login = `background-${randomUUID()}`,
  password = randomUUID();
// Use the isolated launcher's default context via CDP without focus emulation.
// No user profile is opened, and the launcher owns temporary profile cleanup.
const test = base.extend({
  context: async ({ playwright }, provideContext) => {
    const port = await freePort();
    const launcher = await playwright.chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
      headless: false,
      args: [
        `--remote-debugging-port=${port}`,
        "--remote-debugging-address=127.0.0.1",
      ],
      ignoreDefaultArgs: [
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });
    try {
      const native = await playwright.chromium.connectOverCDP(
        `http://127.0.0.1:${port}`,
        { noDefaults: true },
      );
      try {
        expect(native.contexts()).toHaveLength(1);
        await provideContext(native.contexts()[0]);
      } finally {
        await native.close();
      }
    } finally {
      await launcher.close();
    }
  },
});

type NativeAudioProbe = {
  sources: { at: number; ended: number | null }[];
  analysers: AnalyserNode[];
};
type ProbedWindow = Window & { nativeAudioProbe: NativeAudioProbe };

test.describe("AG real background browser", () => {
  test("AG global alarm produces native audio in another section, hidden tab and minimized window", async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Observe native audio, retaining real nodes, output, clocks and autoplay policy.
    await page.addInitScript(() => {
      const probe: NativeAudioProbe = { sources: [], analysers: [] };
      (window as unknown as ProbedWindow).nativeAudioProbe = probe;
      const oscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const node = oscillator.call(this);
        const source = { at: performance.now(), ended: null as number | null };
        probe.sources.push(source);
        node.addEventListener("ended", () => {
          source.ended = performance.now();
        });
        return node;
      };
      const gain = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function () {
        const node = gain.call(this);
        const analyser = this.createAnalyser();
        node.connect(analyser);
        probe.analysers.push(analyser);
        return node;
      };
    });
    const audio = () =>
      page.evaluate(() => {
        const probe = (window as unknown as ProbedWindow).nativeAudioProbe;
        const analyser = probe.analysers.at(-1);
        const samples = new Float32Array(analyser?.fftSize ?? 0);
        analyser?.getFloatTimeDomainData(samples);
        return {
          count: probe.sources.length,
          peak: samples.reduce(
            (peak, value) => Math.max(peak, Math.abs(value)),
            0,
          ),
          ...probe.sources.at(-1),
        };
      });
    const capture = async () => {
      const route = await readDriverExecution(
        f.db.pool,
        f.members[0].driverId,
        f.planId,
        f.timezone,
      );
      const stop = route.stops[0];
      return reportProductIncident(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stop.id,
        stop.shipmentIds[0],
        {
          commandId: randomUUID(),
          executionId: route.id,
          publicationRevision: route.publicationRevision,
          executionRevision: route.revision,
          stopVersion: stop.version,
          visitSequence: stop.visitSequence,
          orderVersion: stop.orderStates[0].version,
          formVersion: 3,
          kind: "shortage_validation",
          quantity: "0.1",
          product: "Producto reportado",
          unit: "kg",
          department: "Compras",
          concept: "Error en compra",
          comments: ["late_arrival"],
        },
        f.timezone,
        f.now,
      );
    };
    const expectSound = async (count: number, label: string, since: number) => {
      await expect
        .poll(async () => (await audio()).count, { timeout: 5000 })
        .toBe(count);
      await expect
        .poll(async () => (await audio()).peak, { timeout: 2000 })
        .toBeGreaterThan(0.01);
      const latency = (await audio()).at! - since;
      console.log(
        `AG ${label}: notification-to-audio ${Math.round(latency)}ms`,
      );
      expect(latency).toBeLessThan(5000);
    };
    const quiet = async () => {
      await expect
        .poll(async () => (await audio()).ended, { timeout: 6500 })
        .not.toBeNull();
    };
    expect(
      (
        await page.request.post(`${origin}/api/session`, {
          headers: { Origin: origin },
          data: { login, password },
        })
      ).status(),
    ).toBe(200);
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Incidencias en vivo", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Activar sonido", exact: true })
      .click();
    await expect.poll(async () => (await audio()).peak).toBeGreaterThan(0.01);
    await quiet();
    expect((await audio()).count).toBe(1);
    await f.start(f.members[1]);
    const lateRoute = await readDriverExecution(
      f.db.pool,
      f.members[1].driverId,
      f.planId,
      f.timezone,
    );
    const lateStop = lateRoute.stops[0];
    await executeStopCommand(
      f.db.pool,
      f.members[1].authorization,
      f.planId,
      lateStop.id,
      "arrival",
      {
        commandId: randomUUID(),
        executionId: lateRoute.id,
        publicationRevision: lateRoute.publicationRevision,
        executionRevision: lateRoute.revision,
        stopVersion: lateStop.version,
        visitSequence: lateStop.visitSequence,
        policyVersion: lateRoute.policy.version,
        sample: {
          latitude: 20.64,
          longitude: -103.4,
          accuracyMeters: 5,
          ageMilliseconds: 0,
          capturedAt: f.now.toISOString(),
          mock: false,
        },
      },
      f.timezone,
      f.now,
    );
    const lateBoard = await (
      await page.request.get(`${origin}/api/incidents/board?section=late`)
    ).json();
    const late = lateBoard.rows.find(
      (row: { driverId: string }) => row.driverId === f.members[1].driverId,
    );
    expect(late.kind).toBe("late_arrival");
    const lateCard = page.locator(`[data-incident-key="${late.key}"]`);
    await expect(lateCard).toHaveClass(/incident-unseen/);
    const lateAlerts = await (
      await page.request.get(`${origin}/api/incidents/alerts`)
    ).json();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          `ana-incidents:${lateAlerts.scope}`,
        ),
      )
      .toBe(lateAlerts.cursor);
    expect((await audio()).count).toBe(1);
    expect((await audio()).peak).toBe(0);
    console.log(
      "AG late arrival: visible/unseen, cursor consumed, zero extra audio sources",
    );
    await page
      .getByRole("button", { name: "Incidencias", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Incidencias", exact: true }),
    ).toBeVisible();
    let since = await page.evaluate(() => performance.now());
    await capture();
    await expectSound(2, "other section", since);
    await quiet();
    const cdp = await context.newCDPSession(page);
    const foreground = await context.newPage();
    await foreground.goto("about:blank");
    await foreground.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.visibilityState))
      .toBe("hidden");
    const viewRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/incidents"
      )
        viewRequests.push(request.url());
    });
    since = await page.evaluate(() => performance.now());
    const seen = await capture();
    await expectSound(3, "hidden tab", since);
    expect(
      (
        await page.request.post(`${origin}/api/incidents/seen`, {
          headers: { Origin: origin },
          data: { key: `product:${seen.incidentId}` },
        })
      ).status(),
    ).toBe(200);
    await expect
      .poll(async () => (await audio()).ended, { timeout: 3000 })
      .not.toBeNull();
    expect((await audio()).ended! - (await audio()).at!).toBeLessThan(4500);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    try {
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "minimized" },
      });
      expect(
        (await cdp.send("Browser.getWindowBounds", { windowId })).bounds
          .windowState,
      ).toBe("minimized");
      await expect
        .poll(() => page.evaluate(() => document.visibilityState))
        .toBe("hidden");
      since = await page.evaluate(() => performance.now());
      await capture();
      await expectSound(4, "minimized window", since);
      await quiet();
      const duration = (await audio()).ended! - (await audio()).at!;
      console.log(
        `AG minimized native audio duration: ${Math.round(duration)}ms`,
      );
      expect(Math.abs(duration - 5000)).toBeLessThan(1000);
      await context.setOffline(true);
      await capture();
      expect((await audio()).count).toBe(4);
      since = await page.evaluate(() => performance.now());
      await context.setOffline(false);
      await expectSound(5, "hidden reconnect", since);
      expect(viewRequests).toEqual([]);
      expect(
        (
          await page.request.delete(`${origin}/api/session`, {
            headers: { Origin: origin },
            data: {},
          })
        ).status(),
      ).toBe(200);
      await expect(page).toHaveURL(`${origin}/login`, { timeout: 20000 });
      expect(
        (await page.request.get(`${origin}/api/incidents/alerts`)).status(),
      ).toBe(401);
      expect((await page.request.get(`${origin}/api/events`)).status()).toBe(
        401,
      );
      expect((await audio()).count).toBe(0);
    } finally {
      await context.setOffline(false);
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
      await foreground.close();
      await page.bringToFront();
      await cdp.detach();
    }
    expect(
      (
        await page.request.post(`${origin}/api/session`, {
          headers: { Origin: origin },
          data: { login, password },
        })
      ).status(),
    ).toBe(200);
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Incidencias en vivo", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Activar sonido", exact: true }),
    ).toBeVisible();
    expect((await audio()).count).toBe(0);
    expect(errors).toEqual([]);
  });

  test("AG settlement-only account never mounts the global incident monitor", async ({
    page,
  }) => {
    const account = randomUUID(),
      secret = randomUUID();
    await createUser(f.db.pool, f.actor, {
      name: "Liquidación QA",
      login: account,
      password: secret,
      role: "settlement",
    });
    expect(
      (
        await page.request.post(`${origin}/api/session`, {
          headers: { Origin: origin },
          data: { login: account, password: secret },
        })
      ).status(),
    ).toBe(200);
    const alertRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/incidents/alerts")
        alertRequests.push(request.url());
    });
    await page.goto(origin);
    await expect(
      page.getByLabel("Estado de sincronización", { exact: true }),
    ).toContainText("En vivo");
    await expect(
      page.getByRole("button", { name: "Incidencias en vivo", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Activar sonido", exact: true }),
    ).toHaveCount(0);
    expect(alertRequests).toEqual([]);
    expect(
      (await page.request.get(`${origin}/api/incidents/alerts`)).status(),
    ).toBe(403);
    expect(
      (await page.request.get(`${origin}/api/incidents/board`)).status(),
    ).toBe(403);
  });
});

test.beforeEach(async () => {
  test.setTimeout(120_000);
  f = await executionFixture();
  await f.start();
  await createUser(f.db.pool, f.actor, { name: "Product QA", login, password });
  const execution = await readDriverExecution(
      f.db.pool,
      f.members[0].driverId,
      f.planId,
      f.timezone,
    ),
    stop = execution.stops[0];
  await executeStopCommand(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stop.id,
    "arrival",
    {
      commandId: randomUUID(),
      executionId: execution.id,
      publicationRevision: execution.publicationRevision,
      executionRevision: execution.revision,
      stopVersion: stop.version,
      policyVersion: execution.policy.version,
      sample: {
        latitude: 20.64,
        longitude: -103.4,
        accuracyMeters: 5,
        ageMilliseconds: 0,
        capturedAt: f.now.toISOString(),
        mock: false,
      },
    },
    f.timezone,
    f.now,
  );
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        RUTAS_DATABASE_URL: f.db.config.databaseUrl,
        RUTAS_INSTANCE_ID: f.db.config.instanceId,
        RUTAS_BOOTSTRAP_TOKEN: f.db.config.bootstrapToken,
        RUTAS_APP_ORIGIN: origin,
        RUTAS_TIMEZONE: f.timezone,
        RUTAS_UNIT_PHOTO_DIR: f.photoRoot,
        RUTAS_GOOGLE_MAPS_BROWSER_KEY: "",
        RUTAS_GOOGLE_MAP_ID: "",
        ODOO_URL: "",
        ODOO_DATABASE: "",
        ODOO_EMAIL: "",
        ODOO_API_KEY: "",
      },
    },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/ready`)).ok) return;
    } catch {
      /* local server startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("PRODUCT_SERVER_NOT_READY");
});
test.afterEach(async () => {
  if (server && server.exitCode === null)
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.kill();
    });
  await f?.close();
});
