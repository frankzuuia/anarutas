"use client";
import { useEffect, useId, useRef } from "react";
import { Trash2, X } from "lucide-react";
import type { Plan } from "@/core/plans";

export function DeletePlanDialog({
  plan,
  busy,
  onClose,
  onConfirm,
}: {
  plan: Plan;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      className="fleet-dialog remove-vehicle-dialog"
      ref={dialog}
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>Borrar plan</h2>
        <button
          type="button"
          className="quiet"
          aria-label="Cerrar confirmación"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="panel-body stack">
        <div id={description}>
          <p>¿Deseas borrar este plan completo?</p>
          <p className="removal-impact">
            <strong>{plan.label}</strong> · {plan.service_date}
          </p>
        </div>
        <p className="muted">
          Se eliminarán sus pedidos y camionetas seleccionadas únicamente de
          este borrador. La flota, los choferes y Odoo no se modifican.
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            <Trash2 size={16} aria-hidden="true" />
            {busy ? "Borrando…" : "Borrar plan"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
