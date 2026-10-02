import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { startPostgres, freePort } from "../helpers/postgres";
import { bootstrap, createUser } from "../../src/core/auth";
import { createDriver } from "../../src/core/fleet";
import { createPlan } from "../../src/core/plans";
import { todayInTimezone } from "../../src/core/local-date";

let db: Awaited<ReturnType<typeof startPostgres>>,
  server: ChildProcess | undefined,
  origin: string,
  actor: string,
  driverId: string;
const password = randomUUID();
test.beforeAll(async () => {
  test.setTimeout(120000);
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Rutas navegación QA",
      login: "nav-routes",
      password,
    })
  ).id;
  await createUser(db.pool, actor, {
    name: "Liquidación navegación QA",
    login: "nav-settlement",
    password,
    role: "settlement",
  });
  driverId = (
    await createDriver(db.pool, actor, {
      id: randomUUID(),
      name: "Chofer de navegación",
      phone: "3310000100",
      emergency_name: "",
      emergency_phone: "",
      blood_type: "",
      active: true,
    })
  ).id;
  await createPlan(db.pool, actor, {
    date: todayInTimezone(db.config.timezone),
    label: "Navegación QA",
  });
  origin = `http://127.0.0.1:${await freePort()}`;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      new URL(origin).port,
    ],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        RUTAS_DATABASE_URL: db.config.databaseUrl,
        RUTAS_INSTANCE_ID: db.config.instanceId,
        RUTAS_APP_ORIGIN: origin,
        RUTAS_TIMEZONE: db.config.timezone,
        ODOO_URL: "",
        ODOO_DATABASE: "",
        ODOO_EMAIL: "",
        ODOO_API_KEY: "",
        RUTAS_GOOGLE_MAPS_BROWSER_KEY: "",
        RUTAS_GOOGLE_MAP_ID: "",
      },
    },
  );
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${origin}/api/ready`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 45000 },
    )
    .toBe(200);
  await mkdir(".local/qa-mobile-navigation", { recursive: true });
});
test.afterAll(async () => {
  if (server && server.exitCode === null)
    await new Promise<void>((resolve) => {
      server!.once("exit", () => resolve());
      server!.kill();
    });
  await db?.close();
});

for (const role of ["routes", "settlement"] as const)
  test(`real mobile navigation keeps focus, roles, state and desktop behavior: ${role}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors: string[] = [],
      timings: number[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    const session = await page.request.post(`${origin}/api/session`, {
      headers: { Origin: origin },
      data: { login: `nav-${role}`, password },
    });
    expect(session.status()).toBe(200);
    await page.goto(origin);
    const drawer = page.getByRole("dialog", {
      name: "Menú de administración",
      exact: true,
    });
    const opener = page.locator(".mobile-menu-toggle");
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(drawer).toBeHidden();
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    expect((await page.locator(".topbar").boundingBox())!.y).toBe(0);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: role === "routes" ? "Planificar rutas" : "Liquidación de rutas",
        exact: true,
      }),
    ).toBeVisible();
    if (role === "settlement") {
      await page
        .getByRole("combobox", { name: "Chofer", exact: true })
        .selectOption(driverId);
      await expect(
        page.getByText("No hay pedidos cobrados en estas fechas.", {
          exact: true,
        }),
      ).toBeVisible();
    }
    const open = async () => {
      const start = performance.now();
      await opener.click();
      await expect(drawer).toBeVisible();
      timings.push(performance.now() - start);
      await expect(opener).toHaveAttribute("aria-expanded", "true");
    };
    const closed = async () => {
      await expect(drawer).toBeHidden();
      await expect(opener).toBeFocused();
      await expect(opener).toHaveAttribute("aria-expanded", "false");
      expect(
        await page.evaluate(() => document.documentElement.style.overflow),
      ).toBe("");
    };
    const contentBefore = await page.locator("main").boundingBox();
    await open();
    await expect(
      drawer.getByRole("button", { name: "Cerrar menú", exact: true }),
    ).toBeFocused();
    expect(await page.locator("main").boundingBox()).toEqual(contentBefore);
    const nav = drawer.getByRole("navigation", {
      name: "Navegación principal",
    });
    const buttons = nav.getByRole("button");
    await expect(buttons).toHaveCount(13);
    const rows = await buttons.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    expect(new Set(rows.map((row) => row.x)).size).toBe(1);
    expect(rows.every((row) => row.height >= 44)).toBe(true);
    expect(
      rows
        .slice(1)
        .every((row, index) => row.y >= rows[index].y + rows[index].height),
    ).toBe(true);
    expect(await drawer.boundingBox()).toMatchObject({
      x: 0,
      y: 0,
      width: 300,
      height: 844,
    });
    await expect(
      nav.getByRole("button", { name: "Liquidación de rutas", exact: true }),
    )[role === "settlement" ? "toBeEnabled" : "toBeDisabled"]();
    await expect(
      nav.getByRole("button", { name: "Planificar rutas", exact: true }),
    )[role === "routes" ? "toBeEnabled" : "toBeDisabled"]();
    for (const key of [
      ...Array<string>(16).fill("Tab"),
      ...Array<string>(16).fill("Shift+Tab"),
    ]) {
      await page.keyboard.press(key);
      expect(
        await drawer.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    await drawer.locator(".brand").click();
    await expect(drawer).toBeVisible();
    await page.mouse.move(30, 30);
    await page.mouse.down();
    await page.mouse.move(382, 120);
    await page.mouse.up();
    await expect(drawer).toBeVisible();
    await page.screenshot({
      path: `.local/qa-mobile-navigation/open-${role}.png`,
    });
    await page.mouse.click(382, 150);
    await closed();
    await open();
    await page.keyboard.press("Escape");
    await closed();
    await open();
    await drawer
      .getByRole("button", { name: "Cerrar menú", exact: true })
      .click();
    await closed();

    await page.setViewportSize({ width: 390, height: 420 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight > innerHeight,
      ),
    ).toBe(true);
    await page.evaluate(() => scrollTo(0, 100));
    // Measure after the user's menu trigger is in view, before opening it.
    await opener.scrollIntoViewIfNeeded();
    const beforeScroll = await page.evaluate(() => scrollY);
    const shortContent = await page.locator("main").boundingBox();
    await open();
    expect(await page.locator("main").boundingBox()).toEqual(shortContent);
    await page.mouse.move(382, 200);
    await page.mouse.wheel(0, 500);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    expect(await page.evaluate(() => scrollY)).toBe(beforeScroll);
    await nav
      .getByRole("button", { name: "Control de consumo", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      drawer.getByRole("button", { name: "Cerrar menú", exact: true }),
    ).toBeVisible();
    expect(
      await drawer
        .locator(".mobile-navigation-scroll")
        .evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await closed();

    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    const enlargedText = await page.addStyleTag({
      content: ".mobile-navigation-dialog .nav button { font-size: 20px; }",
    });
    await open();
    expect(
      await buttons
        .first()
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("20px");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await drawer.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/qa-mobile-navigation/narrow-${role}.png`,
    });
    await page.keyboard.press("Escape");
    await closed();
    await enlargedText.evaluate((element) =>
      element.parentNode?.removeChild(element),
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    await drawer
      .getByRole("button", { name: "Cerrar menú", exact: true })
      .focus();
    const identity = await drawer.elementHandle();
    await createDriver(db.pool, actor, {
      id: randomUUID(),
      name: `Actualización ${role}`,
      phone: role === "routes" ? "3310000101" : "3310000102",
      emergency_name: "",
      emergency_phone: "",
      blood_type: "",
      active: true,
    });
    if (role === "settlement")
      await expect(
        page
          .getByRole("combobox", { name: "Chofer", exact: true })
          .locator("option", { hasText: `Actualización ${role}` }),
      ).toHaveCount(1);
    else
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`${origin}/api/drivers`)).json())
              .length,
        )
        .toBeGreaterThan(1);
    expect(
      await identity!.evaluate(
        (element) =>
          element === document.querySelector(".mobile-navigation-dialog") &&
          element.hasAttribute("open"),
      ),
    ).toBe(true);
    await expect(
      drawer.getByRole("button", { name: "Cerrar menú", exact: true }),
    ).toBeFocused();
    const target = role === "routes" ? "Choferes" : "Liquidación de rutas";
    await nav.getByRole("button", { name: target, exact: true }).click();
    await closed();
    await expect(
      page.getByRole("heading", { name: target, level: 1, exact: true }),
    ).toBeVisible();
    if (role === "settlement")
      await expect(
        page.getByRole("combobox", { name: "Chofer", exact: true }),
      ).toHaveValue(driverId);
    await page.screenshot({
      path: `.local/qa-mobile-navigation/closed-${role}.png`,
    });

    await open();
    await page.setViewportSize({ width: 720, height: 480 });
    await expect(drawer).toBeVisible();
    await page.setViewportSize({ width: 721, height: 480 });
    await expect(drawer).toBeHidden();
    await expect(page.locator(".desktop-menu-toggle")).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.style.overflow),
    ).toBe("");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".sidebar")).toBeVisible();
    await page
      .getByRole("button", { name: "Cerrar menú", exact: true })
      .click();
    await expect(page.locator(".sidebar")).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(drawer).toBeHidden();
    await open();
    await page.keyboard.press("Escape");
    await closed();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".sidebar")).toBeHidden();
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await page.screenshot({
      path: `.local/qa-mobile-navigation/desktop-${role}.png`,
    });
    expect((await page.request.get(`${origin}/api/settlements`)).status()).toBe(
      role === "settlement" ? 200 : 403,
    );
    expect((await page.request.get(`${origin}/api/drivers`)).status()).toBe(
      role === "routes" ? 200 : 403,
    );
    expect(errors).toEqual([]);
    timings.sort((a, b) => a - b);
    await writeFile(
      `.local/qa-mobile-navigation/metrics-${role}.json`,
      JSON.stringify(
        {
          role,
          samples: timings.length,
          p95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
          maximumMs: timings.at(-1),
          errors,
          environment:
            "Chrome desktop engine with real responsive viewports, Next production build and isolated PostgreSQL; not physical-device certification or load test",
        },
        null,
        2,
      ),
    );
  });

test("touchscreen opens the drawer and closes by outside tap, X and selection", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    const session = await page.request.post(`${origin}/api/session`, {
      headers: { Origin: origin },
      data: { login: "nav-settlement", password },
    });
    expect(session.status()).toBe(200);
    await page.goto(origin);
    const drawer = page.getByRole("dialog", {
      name: "Menú de administración",
      exact: true,
    });
    const opener = page.locator(".mobile-menu-toggle");
    await expect(drawer).toBeHidden();
    await opener.tap();
    await expect(drawer).toBeVisible();
    await drawer.locator(".brand").tap();
    await expect(drawer).toBeVisible();
    await page.evaluate(() => {
      document.body.dataset.backdropClickLeaks = "0";
      document.body.addEventListener("click", (event) => {
        if (
          event.target instanceof Element &&
          !event.target.closest(
            ".mobile-navigation-dialog, .mobile-menu-toggle",
          )
        ) {
          document.body.dataset.backdropClickLeaks = String(
            Number(document.body.dataset.backdropClickLeaks) + 1,
          );
        }
      });
    });
    await page.touchscreen.tap(382, 150);
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
    expect(
      await page.locator("body").getAttribute("data-backdrop-click-leaks"),
    ).toBe("0");
    await opener.tap();
    await drawer
      .getByRole("button", { name: "Cerrar menú", exact: true })
      .tap();
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.tap();
    await drawer
      .getByRole("button", { name: "Liquidación de rutas", exact: true })
      .tap();
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(
      page.getByRole("heading", { level: 1, name: "Liquidación de rutas" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.style.overflow),
    ).toBe("");
  } finally {
    await context.close();
  }
});
