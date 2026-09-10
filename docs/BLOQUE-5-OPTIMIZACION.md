# Bloque 5 — optimización vial y salida operativa

## Alcance autorizado

Este bloque convierte el borrador manual en una propuesta real de Google Route
Optimization. No incorpora peso, volumen ni capacidad de camionetas. El modelo usa:

- un único punto de salida confirmado por el administrador;
- camionetas seleccionadas en el borrador;
- puntos de entrega confirmados por cliente;
- ventanas de entrega de 24 horas y prioridad Alta/Media/Por horario;
- tráfico, distancia, duración, polilínea y secuencia calculados por Google.

La salida inicial de develop se sugiere por configuración runtime como `Calle 5
1106, Colonia Industrial, Guadalajara, Jalisco, México`, pero nunca se
convierte en coordenada sin confirmación visual. No se configura regreso al almacén.

## Contratos

1. `GET /api/routing/settings` devuelve sólo configuración operativa no secreta.
2. `PUT /api/routing/settings` guarda dirección y punto de salida confirmados con
   `expectedVersion`; el actor procede de sesión y se registra auditoría.
3. `POST /api/plans/:id/optimization` toma `expectedVersion`, lee un snapshot coherente,
   consulta Google fuera de una transacción y aplica el resultado sólo si la versión
   del plan continúa intacta.
4. No se aceptan proyecto, credenciales, URL de Google, coordenadas de pedidos,
   vehículos ni un modelo arbitrario desde el cliente.
5. La respuesta pública conserva asignación, orden, ETA y métricas; no devuelve la
   cuenta de servicio ni los route tokens reservados para la futura APK.

## Modelo y política

- Cada pedido es una entrega obligatoria identificada por el UUID interno en `label`.
- Cada camioneta es un vehículo `DRIVING` cuyo inicio es el punto de salida. No tiene
  `endLocation`, `loadLimits` ni demanda de carga.
- Las ventanas del cliente son límites duros. El día operativo global es el día civil
  completo del plan en `RUTAS_TIMEZONE`.
- Alta precede a Media y Por horario; Media precede a Por horario mediante reglas de
  precedencia entre entregas. Una incompatibilidad se informa y no se oculta.
- Se solicita tráfico, polilínea global y polilíneas/tokens por transición. Los tokens
  se guardan privados para Navigation SDK Android posterior.
- El timeout se deriva del tamaño y complejidad del lote usando las bandas publicadas
  por Google; no es un límite artificial de salida.

## Persistencia aditiva v6

- `route_routing_settings`: punto de salida, versión y autor.
- `route_optimization_runs`: snapshot de versión, estado, métricas sanitizadas,
  rutas/polilíneas y fallos de pedidos; nunca credenciales.
- `route_optimization_leases`: exclusión temporal por plan/versión para evitar
  cálculos duplicados y cargos dobles entre sesiones; expira para permitir recuperación.
- `route_optimization_stops`: resultado normalizado por camioneta/pedido con posición,
  ETA y métricas de tramo.

Los movimientos manuales posteriores incrementan la versión del plan. Un resultado
anterior permanece para auditoría, pero se marca obsoleto y no se presenta como ruta
vigente.

## Fallos y recuperación

- Sin salida confirmada, camionetas, pedidos o puntos confirmados: 409 sin llamada a
  Google ni escritura parcial.
- Google no autorizado, cuota, timeout o modelo inválido: error sanitario con request
  ID; el borrador conserva exactamente su versión previa.
- Cambio concurrente durante la llamada externa: 409; el resultado no pisa el plan.
- Pedido omitido por Google: permanece Sin asignar con razón normalizada para revisión.
- Reintento sobre la misma versión usa una clave de operación estable y no duplica una
  aplicación ya confirmada.

## Referencias oficiales

- `projects.optimizeTours`: https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/projects/optimizeTours
- Estructura del modelo: https://developers.google.com/maps/documentation/route-optimization/concepts/base-structure
- Ventanas: https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows
- Polilíneas y route tokens: https://developers.google.com/maps/documentation/route-optimization/polylines-and-route-tokens
- Timeouts: https://developers.google.com/maps/documentation/route-optimization/timeouts

## Puertas de calidad

- Unidades: configuración, fecha civil→RFC3339, modelo, precedencias, timeout y parser
  estricto de respuesta.
- PostgreSQL real: migración v6, versión concurrente, aplicación atómica, reintento y
  resultado obsoleto.
- Contrato HTTP: autenticación OAuth real construida desde cuenta de servicio y fetch
  con timeout; secretos ausentes de errores, auditoría y respuestas.
- E2E: salida pendiente/confirmada, optimización, rutas visibles, omisiones, conflicto
  y movimiento manual que invalida la ruta.
- Seguridad: Origin/JSON/sesión, límites de cuerpo, UUID de labels, coordenadas dentro
  de rango, ninguna URL o credencial controlada por cliente.
- Cobertura integral y mutación estricta sobre constructor, parser y validación del
  contrato crítico con Google; la aplicación atómica se comprueba con PostgreSQL real.
