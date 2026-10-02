# ZD — Zonas automáticas y descarga por cliente

Autorizado el 2026-10-02: «que las mande a las camionetas por zonas», limitado
al armado, cálculo de rutas y campo del directorio. Continúa explícito del usuario.

## Diagnóstico y reglas

BL-ZD01: administrador de rutas → descarga configurable en minutos, entre Prioridad
y Modalidad. Columna nullable en route_customers, migración43; sin configurar no
inventa minutos. Clientes HTTP anteriores que omiten el campo conservan su valor.
Validación entera no negativa y menor al horizonte técnico del modelo (364 días).
Permiso/versionado/auditoría customer.updated existentes. Odoo no lo sobrescribe.

BL-ZD02: una visita consume el tiempo de cada cliente atendido una vez, aunque tenga
varios pedidos. Clientes diferentes coincidentes suman sus tiempos. En recorrido
manual, regresar después a ese punto constituye otra visita. El modelo Google usa
VisitRequest.duration; recálculo suma servicio antes del siguiente tramo/regreso.
Huellas de cálculo incluyen minutos normalizados, para rechazar resultados obsoletos
y conflictos durante cálculo. Snapshots iniciados e historial no se reescriben.

BL-ZD03: flota del plan → zonas automáticas por proximidad de puntos confirmados.
Partición determinista mediante centros iniciales separados y asignación al centro
más cercano hasta convergencia, sin forzar igualdad de pedidos entre barrios.
Puntos idénticos pertenecen a una sola zona aun con clientes/horarios distintos.
Número de zonas = mínimo de puntos distintos y camionetas del plan. Google recibe
allowedVehicleIndices para mantener cada zona en su camioneta, horarios/prioridades
vigentes y regreso. Optimiza la secuencia vial; no se reordena después del éxito.
La recuperación utiliza las mismas zonas y mide calles con Routes; si falla, rollback.
Zonas no garantizan calles exclusivas ni óptimo global; accesos compartidos y ventanas
pueden producir recorridos coincidentes. Sin cambios a arrastre manual, app, cobros,
validación Odoo, publicación o permisos. No añade consultas facturables para QA.

## Escenarios y tareas verificables

| ID | Precondición/disparo | Resultado / evidencia | Recuperación |
| --- | --- | --- | --- |
| ZD01 | Admin guarda/borra minutos | DB y lectura coherentes; unidad/PG/UI | Versión vieja409, entrada inválida400 |
| ZD02 | Cliente anterior omite campo/sincroniza Odoo | Conserva configuración; PG | Transacción atómica |
| ZD03 | Varios pedidos/mismo cliente o punto | Servicio sin duplicación por pedido; contrato y recálculo | Datos inválidos rechazados |
| ZD04 | Cambio durante cálculo | Huella diferente; rechazo antes de guardar; PG | Recalcular borrador vigente |
| ZD05 | Barrios separados/desbalanceados y distintas flotas | Destinos próximos agrupados, cobertura única y estable; unidad | Cero omisiones |
| ZD06 | Google ignora zona o devuelve respuesta incompleta | Rechazo de contrato; recuperación con mismas zonas | Fallo vial conserva borrador |
| ZD07 | Arrastre manual/revisita/espera/regreso | Secuencia preservada, servicio y ETAs sumados; unidad/PG | Worker existente |
| ZD08 | Migración repetida/concurrente, roles no autorizados | Conservación, aislamiento; PG/HTTP | Rollback |
| ZD09 | Rutas iniciadas y finalizadas | Snapshots intactos; regresión | Sin cambios operativos |

T01: migración/contrato/editor y QA ZD01/02/08. T02: tiempo y huellas ZD03/04/07/09.
T03: zonas/modelo/recuperación ZD05/06. T04: pruebas, cobertura por riesgo,
mutación, E2E real, lint/typecheck/build y reporte QA. Sólo develop después de gates.

Referencias: Next16 use-client local; Google ShipmentModel (VisitRequest.duration,
Shipment.allowedVehicleIndices):
https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel

Auditoría de alcance: sustituye asignación global libre de FD01/07 por zonas;
conserva llamada Fleet única, respuesta vial, recuperación medida y protección de
concurrencia. GREEN LIGHT para construcción; MATCH PERFECT T01..04/ZD01..09.
Pruebas locales de contratos no equivalen a certificación del recorrido Google live.
