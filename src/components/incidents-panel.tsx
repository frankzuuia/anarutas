"use client";

import { Clock3 } from "lucide-react";

export function IncidentsPanel() {
  return (
    <section
      className="panel incidents-panel"
      aria-label="Incidencias reales de rutas"
    >
      <div className="panel-body stack">
        <p className="notice">
          Este módulo sólo mostrará incidencias creadas a partir de eventos
          reales del chofer. Las ETA, ventanas y previsiones de Google no crean
          incidencias.
        </p>
        <div className="empty">
          <Clock3 size={28} aria-hidden="true" />
          <h2>Sin incidencias reales registradas</h2>
          <p>
            La APK ya permite iniciar rutas. La captura de «Llegué» e incidencias
            todavía está pendiente; no hay eventos de llegada que consultar.
          </p>
          <p>
            Cuando se incorpore esa captura, «Llegué» registrará la hora real de
            llegada y el inicio del surtido. Sólo entonces podrá calcularse y
            guardarse un retraso real contra la ventana de recepción.
          </p>
        </div>
      </div>
    </section>
  );
}
