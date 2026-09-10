"use client";
import { useEffect, useId, useRef } from "react";
import { Archive, RotateCcw, X } from "lucide-react";
import type { Customer } from "@/core/customers-contract";

export function CustomerArchiveDialog({
  customer,
  restoring,
  busy,
  onClose,
  onConfirm,
}: {
  customer: Customer;
  restoring: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>
          {restoring ? "Restaurar cliente" : "Archivar cliente"}
        </h2>
        <button
          type="button"
          className="quiet"
          aria-label="Cerrar"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="panel-body stack">
        <p>
          {restoring
            ? `¿Deseas restaurar ${customer.displayName} con toda su configuración?`
            : `¿Deseas archivar ${customer.displayName}? Sus pedidos y su configuración no se eliminarán.`}
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
            className={restoring ? "primary" : "danger"}
            disabled={busy}
            onClick={onConfirm}
          >
            {restoring ? <RotateCcw size={16} /> : <Archive size={16} />}
            {busy ? "Guardando…" : restoring ? "Restaurar" : "Archivar"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
