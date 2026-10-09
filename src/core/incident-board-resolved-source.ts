/** Read-only projection of resolved records. It never enrolls them in the live alarm source. */
export const resolvedIncidentSource = `(
  SELECT 'product'::text AS source,i.id,i.kind,i.driver_id,i.occurred_at,i.event_date,i.timezone,i.status,i.version,
    jsonb_build_object('driver',i.snapshot->>'driver','customer',i.snapshot->>'customer',
      'vehicle',i.snapshot->>'vehicle','plate',i.snapshot->>'plate','address',i.snapshot->>'address',
      'planLabel',i.snapshot->>'planLabel','orders',jsonb_build_array(i.order_name),
      'note',COALESCE(a.comment,i.note),'product',i.product,'quantity',i.quantity::text,'unit',i.unit,
      'warehouseReason',i.warehouse_reason,'resolutionNote',i.resolution_note,
      'photos',COALESCE((SELECT jsonb_agg(p.evidence_id ORDER BY p.position)
        FROM route_product_incident_photos p WHERE p.incident_id=i.id),'[]'::jsonb)
        || CASE WHEN i.evidence_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(i.evidence_id) END,
      'canResolve',false) AS detail
  FROM route_product_incidents i LEFT JOIN route_product_incident_annotations a ON a.incident_id=i.id
  WHERE i.status='resolved' AND i.report_removed_at IS NULL
  UNION ALL
  SELECT * FROM route_incident_live_entries WHERE source='service' AND status='resolved_by_admin'
)`;

export const seenIncidentSource = `(
  SELECT * FROM route_incident_live_entries
  UNION ALL
  SELECT * FROM ${resolvedIncidentSource} resolved WHERE resolved.source='product'
)`;
