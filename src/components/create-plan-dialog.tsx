"use client";
import { useEffect, useId, useRef, type FormEventHandler } from "react";
import { CalendarPlus, X } from "lucide-react";

export function CreatePlanDialog({
  today,
  busy,
  onClose,
  onSubmit,
}: {
  today: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className="fleet-dialog create-plan-dialog"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>
          <CalendarPlus size={18} /> Nuevo borrador
        </h2>
        <button
          type="button"
          className="quiet"
          aria-label="Cerrar nuevo borrador"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <form className="panel-body stack" onSubmit={onSubmit}>
        <label>
          Fecha de operación
          <input type="date" name="date" defaultValue={today} required />
        </label>
        <label>
          Nombre del plan
          <input
            name="label"
            placeholder="Ej. Entregas del día"
            maxLength={120}
            required
            autoFocus
          />
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            <CalendarPlus size={17} />
            {busy ? "Creando…" : "Crear borrador"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
