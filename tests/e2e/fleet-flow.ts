import { expect, type Page, type BrowserContext } from "@playwright/test";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import type { Driver, Vehicle } from "../../src/core/fleet-contract";

export async function fleetFlow(
  page: Page,
  context: BrowserContext,
  second: BrowserContext,
  origin: string,
) {
  await page.getByRole("button", { name: "Camionetas", exact: true }).click();
  await expect(page.getByText("Aún no hay camionetas")).toBeVisible();
  async function vehicle(name: string, plate: string) {
    await page
      .getByRole("button", { name: "Añadir camioneta", exact: true })
      .click();
    await page.getByLabel("Nombre de unidad").fill(name);
    await page.getByLabel("Marca", { exact: true }).fill("Marca QA");
    await page.getByLabel("Modelo", { exact: true }).fill("Modelo QA");
    await page.getByLabel("Placas", { exact: true }).fill(plate);
    await page.getByLabel("Kilometraje", { exact: true }).fill("12500.50");
    await page
      .getByLabel("Combustible", { exact: true })
      .selectOption("Diésel");
    await page
      .getByRole("button", { name: "Guardar camioneta", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("article", { name, exact: true }),
    ).toBeVisible();
  }
  await vehicle("Unidad QA 1", "QA-001");
  const card = page.getByRole("article", { name: "Unidad QA 1", exact: true });
  const availability = card.getByRole("switch", {
    name: "Disponibilidad de Unidad QA 1",
  });
  await expect(availability).toBeChecked();
  await expect(card.getByText("Disponible", { exact: true })).toBeVisible();
  await availability.click();
  await expect(availability).not.toBeChecked();
  await expect(card.getByText("No disponible", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Camionetas", exact: true }).click();
  await expect(availability).not.toBeChecked();
  await availability.click();
  await expect(availability).toBeChecked();
  await expect(card.getByText("Disponible", { exact: true })).toBeVisible();
  await card
    .getByRole("button", { name: "Asignar chofer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Registrar nuevo chofer", exact: true })
    .click();
  await page
    .getByLabel("Nombre del chofer", { exact: true })
    .fill("Chofer de validación");
  await page
    .getByLabel("Teléfono del chofer", { exact: true })
    .fill("3300000050");
  await page
    .getByLabel("Contacto de emergencia", { exact: true })
    .fill("Contacto QA");
  await page
    .getByLabel("Teléfono de emergencia", { exact: true })
    .fill("3300000051");
  await page
    .getByLabel("Tipo de sangre (opcional)", { exact: true })
    .selectOption("O+");
  await page
    .getByRole("button", { name: "Guardar chofer", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Asignar chofer" }),
  ).toBeVisible();
  await page
    .getByLabel("Chofer", { exact: true })
    .selectOption({ label: "Chofer de validación" });
  await page
    .getByRole("button", { name: "Guardar asignación", exact: true })
    .click();
  await expect(card).toContainText("Chofer de validación");
  await availability.click();
  await expect(page.locator("p.notice.error[role='alert']")).toContainText(
    "Primero quita la asignación del chofer",
  );
  await expect(availability).toBeChecked();
  await expect(card.getByText("Disponible", { exact: true })).toBeVisible();
  await vehicle("Unidad QA 2", "QA-002");
  await page
    .getByRole("article", { name: "Unidad QA 2", exact: true })
    .getByRole("button", { name: "Asignar chofer", exact: true })
    .click();
  const occupiedOption = page.getByRole("option", {
    name: "Chofer de validación · En Unidad QA 1",
  });
  await expect(occupiedOption).toHaveAttribute("disabled", "");
  expect(
    await occupiedOption.evaluate(
      (option: HTMLOptionElement) => option.disabled,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();

  let records: Vehicle[] = await (
    await context.request.get(`${origin}/api/vehicles`)
  ).json();
  const first = records.find((v) => v.name === "Unidad QA 1")!;
  const other = records.find((v) => v.name === "Unidad QA 2")!;
  const conflict = await second.request.put(
    `${origin}/api/vehicles/${other.id}/driver`,
    {
      headers: { Origin: origin },
      data: { driver_id: first.driver_id, expectedVersion: other.version },
    },
  );
  expect(conflict.status()).toBe(409);
  const changed = await second.request.patch(
    `${origin}/api/vehicles/${first.id}`,
    {
      headers: { Origin: origin },
      data: { ...first, mileage: 12501, expectedVersion: first.version },
    },
  );
  expect(changed.status()).toBe(200);
  await card.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Kilometraje", { exact: true }).fill("12502");
  await page
    .getByRole("button", { name: "Guardar camioneta", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "cambió en otra sesión",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(card).toContainText("12,501 km");

  await page.getByRole("button", { name: "Choferes", exact: true }).click();
  await page
    .getByRole("button", { name: "Fotos y licencia", exact: true })
    .click();
  // Generated pixels are an explicit QA file fixture, never a production document.
  const png = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#17814a" },
  })
    .png()
    .toBuffer();
  const kinds = ["photo", "license_front", "license_back"];
  const labels = ["Foto del chofer", "Licencia · frente", "Licencia · reverso"];
  for (let i = 0; i < kinds.length; i++) {
    const input = page.getByLabel(labels[i], { exact: true });
    await input.setInputFiles({
      name: `qa-${i}.png`,
      mimeType: "image/png",
      buffer: png,
    });
    const uploaded = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        r.url().endsWith(`/documents/${kinds[i]}`),
    );
    await input
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Subir foto", exact: true })
      .click();
    expect((await uploaded).status()).toBe(200);
    await expect(
      page.getByRole("img", { name: labels[i], exact: true }),
    ).toBeVisible();
  }
  let drivers: Driver[] = await (
    await context.request.get(`${origin}/api/drivers`)
  ).json();
  const driver = drivers[0];
  expect(driver.documents).toHaveLength(3);
  const url = `${origin}/api/drivers/${driver.id}/documents/photo`;
  const stored = await context.request.get(url);
  expect(stored.status()).toBe(200);
  expect(stored.headers()["cache-control"]).toContain("no-store");
  expect(stored.headers()["content-type"]).toBe("image/webp");
  const initialBytes = await stored.body();
  expect((await sharp(initialBytes).metadata()).format).toBe("webp");
  expect((await fetch(url)).status).toBe(401);
  expect((await fetch(`${origin}/api/vehicles`)).status).toBe(401);
  expect((await fetch(`${origin}/api/drivers`)).status).toBe(401);
  for (const check of [
    {
      origin: "https://other.example",
      version: driver.version,
      data: png,
      status: 403,
    },
    {
      origin,
      version: driver.version,
      data: Buffer.from("not a photograph"),
      status: 415,
    },
    { origin, version: driver.version - 1, data: png, status: 409 },
  ]) {
    const rejected = await second.request.put(url, {
      data: check.data,
      headers: {
        Origin: check.origin,
        "Content-Type": "image/png",
        "X-Record-Version": String(check.version),
      },
    });
    expect(rejected.status()).toBe(check.status);
    expect(await (await context.request.get(url)).body()).toEqual(initialBytes);
  }
  for (const width of [375, 940, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `reports/screenshots/fleet-documents-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Cerrar formulario", exact: true })
    .click();
  await expect(page.getByText("Documentos: 3 de 3 cargados")).toBeVisible();
  await page.getByRole("button", { name: "Camionetas", exact: true }).click();
  await expect(
    card.getByRole("img", { name: "Foto de Chofer de validación" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Unidad QA 2", exact: true })
      .getByRole("img"),
  ).toHaveCount(0);
  for (const width of [375, 940, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `reports/screenshots/fleet-vehicles-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await card.getByRole("button", { name: "Editar", exact: true }).click();
    await page.screenshot({
      path: `reports/screenshots/fleet-form-${width}.png`,
      fullPage: true,
    });
    expect(
      await page
        .locator("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  }
  const duplicate = await context.request.post(`${origin}/api/vehicles`, {
    headers: { Origin: origin },
    data: { ...first, id: randomUUID(), mileage: 1 },
  });
  expect(duplicate.status()).toBe(409);
  records = await (await context.request.get(`${origin}/api/vehicles`)).json();
  drivers = await (await second.request.get(`${origin}/api/drivers`)).json();
  expect(records).toHaveLength(2);
  expect(drivers).toHaveLength(1);
  return { url, initialBytes };
}
