"use client";
import { useId, useRef, useState, type FormEventHandler } from "react";
import { Pencil, Save } from "lucide-react";
import type { Plan } from "@/core/plans";

export function DraftName({
  plan,
  busy,
  onSubmit,
}: {
  plan: Plan;
  busy: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(plan.label);
  const action = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  function cancel() {
    setName(plan.label);
    setEditing(false);
    action.current?.focus();
  }
  return (
    <>
      <div className="panel-header draft-heading">
        <div className="draft-title">
          <h2>{plan.label}</h2>
          <small>{plan.service_date}</small>
          <button
            ref={action}
            className="quiet rename-action"
            type="button"
            disabled={busy}
            aria-expanded={editing}
            aria-controls={editorId}
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} aria-hidden="true" />
            Cambiar nombre
          </button>
        </div>
        <span className="badge amber">Borrador · v{plan.version}</span>
      </div>
      <div className="panel-body draft-details" hidden={!editing}>
        <div id={editorId} hidden={!editing}>
          {editing && (
            <form
              className="form-row"
              onSubmit={onSubmit}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !busy) {
                  event.preventDefault();
                  cancel();
                }
              }}
            >
              <label>
                Nombre del borrador
                <input
                  name="label"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={120}
                  disabled={busy}
                  autoFocus
                />
              </label>
              <div className="row">
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !name.trim() || name.trim() === plan.label}
                >
                  <Save size={16} aria-hidden="true" />
                  {busy ? "Guardando…" : "Guardar cambios"}
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={cancel}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
