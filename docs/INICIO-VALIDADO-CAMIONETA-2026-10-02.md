# Inicio sólo con pedidos validados de la camioneta

Bloque BL191 aprobado por el propietario el 2026-10-02: un pendiente de esa
camioneta impide iniciar hasta validar todos sus pedidos. Cargar, asignar,
ordenar, armar y publicar pendientes siguen permitidos. Cadencia Odoo intacta.

## Autopsia y conexión

Activar ruta en orders-board publica; el inicio real pasa por startDriverRoute.
Este último protege fecha, fotos, dueño, recursos y contenido de publicación,
pero no exige fulfillmentStatus=validated. La comprobación de contenido acepta
pending_validation cuando conserva productos. canStartRoute tampoco comprueba
validación. No confundir publicación con salida ni validación con importes.

El worker ya actualiza route_shipments.snapshot bajo UPDATE del plan. Inicio
mantiene SHARE del mismo plan antes de leer y bloquear la publicación. La nueva
guarda usa esa lectura coherente, sólo de la camioneta autorizada. No añade
llamadas Odoo, locks nuevos, migraciones ni cambios a comandos posteriores.
El retorno idempotente de un inicio confirmado permanece antes de la guarda.

## Contrato y aceptación

- IV01: pending_validation bloquea POST de inicio con 409
  ROUTE_ORDERS_NOT_VALIDATED y pendingValidationOrders (id, orderName).
- IV02: sólo los pedidos actuales de plan+camioneta; pendientes ajenos o sin
  asignar no bloquean. Identidad/contenido siguen comprobados antes de iniciar.
- IV03: validación del último pendiente habilita inicio con requisitos previos
  satisfechos; estado desconocido no autoriza salida. Los snapshots históricos
  sin campo conservan la compatibilidad validated definida por la migración9.
- IV04: publicación, asignación y ruteo conservados; cambios de cantidades,
  cancelación, fotos, fecha y revisión mantienen sus errores previos.
- IV05: rechazo no crea ejecución, inicio ni auditoría de salida. API verifica
  aunque el teléfono tenga datos antiguos o el cliente no reconozca la guarda.
- IV06: fuente y salida se serializan por el plan; dos arranques concurrentes
  conservan un único inicio. Reintento confirmado no evalúa nuevos pendientes.
- IV07: publicación móvil añade lista pendingValidationOrders de sólo lectura.
  Android deshabilita inicio y muestra folios; contrato ausente no se interpreta
  como lista vacía. Un error de API muestra motivo comprensible.
- IV08: cambio de validación altera fingerprint SSE existente; lectura automática
  habilita/deshabilita sin cambiar frecuencia, fotos o publicación congelada.

## Puertas

Unidad de selección y política Android, Gherkin, PostgreSQL real para aislamiento,
rechazo/transición/carreras/replay/evento, HTTP de publicación→inicio y seguridad.
Cobertura objetivo100% del selector nuevo y guardas afectadas; mutantes dirigidos
para bypass, alcance y contrato. Typecheck/lint/build, JVM/Android lint y APK.
QA física conserva excepción informada previa; compilación no prueba dispositivo.
Entrega develop; propietario despliega. Evidencia en QA-INICIO-VALIDADO-0.8.21.md.
