"use client";
import { Clock, X } from "lucide-react";
import { segmentMinutes } from "@/core/live-segment-policy";
import type { useLiveSegment } from "./use-live-segment";

export function LiveSegmentReadout({ query, onClear }: { query: ReturnType<typeof useLiveSegment>; onClear: () => void }) {
  const result = query.result;
  return <div className="live-segment-readout" aria-label="Tiempo estimado entre paradas">
    <div className="live-segment-heading"><strong><Clock size={15} />Tiempo aproximado</strong>
      <button className="quiet" onClick={onClear} aria-label="Quitar consulta de tiempo"><X size={15} /></button></div>
    <div role="status">{query.error || (query.loading ? "Calculando recorrido y descargas…" : result ?
      `${result.fromCurrent ? "Desde ahora · " : "Al salir · "}Parada ${result.fromPosition} → ${result.toPosition}: ${segmentMinutes(result.totalSeconds)}` : "Marca otro relojito para elegir el destino.")}</div>
    {result && <><small>Recorrido: {result.positions.join(" → ")} · Traslados {segmentMinutes(result.travelSeconds)} · Descargas {segmentMinutes(result.serviceSeconds)}</small>
      <small>Consulta {new Date(result.calculatedAt).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}. Tráfico y descargas aproximados; no incluye descarga al llegar.</small>
      {!!result.unknownServiceStops && <small className="live-segment-warning">Falta configurar descarga en {result.unknownServiceStops} parada(s); ese tiempo no está incluido.</small>}
      {!!result.omittedRetries && <small className="live-segment-warning">{result.omittedRetries} reintento(s) fuera de este recorrido.</small>}</>}
    {query.error && <button className="quiet" onClick={query.refresh}>Reintentar tiempo</button>}
  </div>;
}
