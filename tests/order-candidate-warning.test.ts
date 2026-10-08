import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { OrderCandidatePicker } from "../src/components/order-candidate-picker";
import type { CandidateBatch } from "../src/core/order-candidates-contract";

const batch: CandidateBatch = {
  batchId: "local-render",
  date: "2026-10-08",
  expectedVersion: 1,
  expiresAt: "2026-10-08T20:00:00Z",
  candidates: [],
  total: 0,
  pending: 0,
  validated: 0,
  existing: 0,
};
const render = (value: CandidateBatch) =>
  renderToStaticMarkup(
    createElement(OrderCandidatePicker, {
      batch: value,
      timezone: "America/Mexico_City",
      busy: false,
      onBack() {},
      onClose() {},
      async onConfirm() {},
    }),
  );
it("adds a yellow warning below the overview only when archived orders are present", () => {
  expect(render(batch)).not.toContain("candidate-archive-warning");
  expect(render({ ...batch, archivedCustomerOrders: [] })).not.toContain(
    "candidate-archive-warning",
  );
  const html = render({
    ...batch,
    archivedCustomerOrders: [
      {
        pickingId: 2,
        pickingName: "QA/2",
        orderId: 2,
        orderName: "QA-2",
        partnerId: 12,
        customerName: '<script>alert("customer")</script>',
      },
    ],
  });
  expect(html).toContain("Tienes pedidos de clientes archivados en Odoo.");
  expect(html).toContain("Ver pedidos afectados (1)");
  expect(html).toContain("QA-2");
  expect(html).toContain("QA/2");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html.indexOf("candidate-archive-warning")).toBeGreaterThan(
    html.indexOf("candidate-overview"),
  );
  expect(html.indexOf("candidate-archive-warning")).toBeLessThan(
    html.indexOf("candidate-filters"),
  );
  const warning = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
  expect(warning).not.toContain("<input");
  expect(html).toContain('<option value="all"');
  expect(html).toContain('<option value="validated"');
  expect(html).toContain('<option value="pending_validation"');
});
