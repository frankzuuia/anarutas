import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftName } from "../src/components/draft-name";

const plan = {
  id: "qa-draft",
  label: "Reparto del martes",
  version: 3,
  service_date: "2026-09-08",
  updated_at: "2026-09-08T12:00:00Z",
};
function render(label = plan.label, busy = false) {
  return renderToStaticMarkup(
    createElement(DraftName, {
      plan: { ...plan, label },
      busy,
      onSubmit: () => {
        throw new Error("Rendering must not submit");
      },
    }),
  );
}
describe("draft name presentation", () => {
  it("shows the saved title with one collapsed rename action, not a save form", () => {
    const html = render();
    expect(html).toContain("<h2>Reparto del martes</h2>");
    expect(html).toContain("Cambiar nombre");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Borrador · v3");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Guardar nombre");
    expect(html).not.toContain("Guardar cambios");
  });
  it("escapes a user-provided title instead of rendering markup", () => {
    const html = render('<script>alert("qa")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("prevents opening another edit during an operation", () => {
    expect(render(plan.label, true)).toContain('disabled=""');
    expect(render()).not.toContain('disabled=""');
  });
});
