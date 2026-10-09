export const liveIncidentGroups = [
  {
    label: "Reposiciones",
    kinds: ["replacement_quality", "replacement_wrong_product"],
  },
  { label: "Devoluciones", kinds: ["return"] },
  { label: "Faltantes", kinds: ["shortage_validation", "shortage_warehouse"] },
  { label: "Cliente cerrado", kinds: ["customer_closed"] },
  { label: "Pedido rechazado", kinds: ["order_rejected"] },
  { label: "Reprogramados", kinds: ["rescheduled"] },
  { label: "Llegadas fuera de horario", kinds: ["late_arrival"] },
  { label: "Puntos corregidos", kinds: ["location_corrected"] },
] as const;

export function incidentGroup(kind: string): string {
  return (
    liveIncidentGroups.find((group) =>
      (group.kinds as readonly string[]).includes(kind),
    )?.label ?? "Otras incidencias"
  );
}
export function newIncidentSequences(
  cursor: string,
  rows: { sequence: string }[],
): string[] {
  return [
    ...new Set(
      rows
        .filter((row) => BigInt(row.sequence) > BigInt(cursor))
        .map((row) => row.sequence),
    ),
  ];
}
