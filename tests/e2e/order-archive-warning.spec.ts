import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { localShipment } from "../helpers/candidate";
import { partitionArchivedOrders } from "../../src/core/odoo-archived-orders";

test("real picker component: archive notice, selection, filters and mobile layout", async ({
  page,
}) => {
  // Component inputs, not an Odoo/API substitute. Live HTTP integration is tested separately.
  const result = partitionArchivedOrders(
    [1, 2, 3].map((id) => ({
      ...localShipment(id),
      odooPartnerActive: id !== 2,
      ...(id === 3
        ? {
            odooPickingState: "done",
            fulfillmentStatus: "validated" as const,
            validatedAt: "2026-09-11T21:40:34.000Z",
          }
        : {}),
    })),
  );
  const batch = {
    batchId: "component-contract",
    date: "2026-09-11",
    expectedVersion: 1,
    expiresAt: "2026-09-11T23:59:59Z",
    total: 2,
    validated: 1,
    pending: 1,
    existing: 0,
    archivedCustomerOrders: result.archivedCustomerOrders,
    candidates: result.shipments.map((s) => ({
      candidateId: String(s.orderId),
      shipment: s,
      hash: "",
      alreadyLoaded: false,
      hasCoordinates: true,
    })),
  };
  const compiled = await build({
    stdin: {
      contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { OrderCandidatePicker } from './src/components/order-candidate-picker';
      import './src/app/globals.css';
      export function mount(batch) {
        createRoot(document.getElementById('root')).render(React.createElement(OrderCandidatePicker, {
          batch, timezone: 'America/Mexico_City', busy: false,
          onBack(){}, onClose(){}, async onConfirm(selection){
            document.getElementById('selection').textContent = JSON.stringify(selection);
          }
        }));
      }`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    outfile: "component.js",
    format: "iife",
    globalName: "PickerContract",
  });
  const js = compiled.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = compiled.outputFiles.find((f) => f.path.endsWith(".css"))!.text;
  async function mount(value: typeof batch) {
    await page.setContent(
      '<main class="app" style="display:block"><section class="panel" style="width:calc(100% - 24px);max-width:960px;margin:12px auto;padding:16px"><div id="root"></div><output id="selection" hidden></output></section></main>',
    );
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.evaluate((value) => {
      (
        window as unknown as { PickerContract: { mount(v: unknown): void } }
      ).PickerContract.mount(value);
    }, value);
  }
  await mount(batch);
  const warning = page.getByRole("complementary", {
    name: "Pedidos de clientes archivados",
  });
  await expect(warning).toBeVisible();
  await warning.getByText("Ver pedidos afectados (1)").click();
  await expect(warning.getByText("QA-2", { exact: true })).toBeVisible();
  await expect(warning.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Seleccionar QA-2 QA/2", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Guardar pedidos (0)" }),
  ).toBeDisabled();
  await page.getByRole("combobox").selectOption("validated");
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await expect(warning).toBeVisible();
  await page.getByRole("combobox").selectOption("pending_validation");
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await page.getByRole("combobox").selectOption("all");
  await page
    .getByRole("checkbox", { name: "Seleccionar todos los 2 pedidos" })
    .check();
  await expect(
    page.getByRole("button", { name: "Guardar pedidos (2)" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Guardar pedidos (2)" }).click();
  await expect(page.locator("#selection")).toHaveText(
    '{"mode":"all_except","ids":[]}',
  );
  await mkdir("reports/screenshots", { recursive: true });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(warning).toBeVisible();
    const box = await warning.boundingBox();
    expect(box!.width).toBeGreaterThan(width === 1440 ? 700 : 250);
    await page.screenshot({
      path: `reports/screenshots/order-archive-warning-${width}.png`,
      fullPage: true,
    });
  }
  await mount({ ...batch, candidates: [], total: 0, validated: 0, pending: 0 });
  await expect(warning).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Guardar pedidos (0)" }),
  ).toBeDisabled();
});
