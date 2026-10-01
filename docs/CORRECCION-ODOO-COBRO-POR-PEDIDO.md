# Corrección de sincronización y cobro por pedido — 2026-09-30

## Autopsia y alcance autorizado

Odoo ya era consultado automáticamente por financial-worker, pero financial-sync
sólo guardaba revisiones financieras: orderBoard seguía leyendo el snapshot del
borrador. En Android StopAttentionSheet enviaba deliver antes de abrir cobro;
WarehouseReturnPolicy consideraba delivered terminal. finance-read, settlements
y el trigger verify_settlement_request exigían ruta completa para toda recepción.
Estos contratos no satisfacen el flujo corregido por el propietario.

El propietario confirmó recepción exclusiva por la cuenta de liquidación y
cuarta opción Efectivo + transferencia. Sustituye el orden de BL162..169, sin
alterar recibos existentes, permisos de rutas ni integración de sólo lectura.

## Bloques y contratos

1. BL171: una observación coherente de Odoo actualiza estado, fecha de validación
   y partidas del borrador automáticamente. Reutiliza la lectura por IDs del
   worker; no crea RPC por navegador. Bloqueo de planes ordenado antes de objetivos
   financieros; versión, auditoría y SSE existentes. No actualiza carriles
   iniciados ni planes archivados, asignación, orden, ventanas o datos de cliente.
   Movimientos cancelados/cantidad cero se excluyen. Picking cancelado no puede
   publicarse. Antes del primer arranque se comparan los pedidos y las partidas
   vigentes con la publicación: cantidad/producto retirado o reasignación exige
   volver a publicar; nombre del plan y secuencia publicada conservan su contrato.
   El intervalo runtime y backoff son explícitos; no es webhook.
2. BL172: Confirmar atención abre Monto a recibir con el neto oficial. Elegir
   medio/notas y Aceptar guarda entrega y cobro en una sola transacción, con
   visita/revisiones/pertenencia/incidencias y base financiera verificadas. Cancelar
   no escribe ni cierra. Reintento exacto conserva un único recibo; fallo revierte
   ambas acciones. La consulta conserva el desglose monetario e incidencias.
   Entregas anteriores sin cobro permiten recuperación; no habilitan bodega si
   tienen base financiera seguida pendiente de cobro.
3. BL173: cash/transfer cobran exactamente el neto con cambio cero; credit
   conserva deuda y recibido cero. mixed exige efectivo y transferencia positivos,
   cuantizados y suma exacta al neto. Importes decimales y moneda de origen;
   columna de versión distingue recibos antiguos parciales/con cambio. Migración
   aditiva conserva historia y añade componentes verificables en SQL. Totales de
   recepción suman cada componente por moneda, sin duplicar el importe mixto.
4. BL174: un pedido cerrado y cobrado aparece al liquidador aun con ruta activa.
   Tarjeta por cliente/folio, monto/medio, detalle e incidencias; Aceptar desactivado
   hasta solicitud individual del chofer. Liquidar requiere modal Aceptar/Cancelar;
   recepción confirma cliente/folio/importes exactos. Solicitud por ruta completa
   mantiene cierre operativo requerido, reservas únicas, decisión versionada,
   rechazo/reintento y recibos históricos. Eventos existentes actualizan ambos.

## Matriz de aceptación y validación

| Caso | Actor, precondición y evento                                       | Resultado, datos y evidencia                                                                                       |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| CP01 | Odoo asignado → done, peso3 →3.2                                   | borrador cambia sin reimportar; snapshot/revisión/version/audit; PG y Odoo lectura                                 |
| CP02 | Odoo elimina/cancela/añade movimiento                              | partidas exactas, notas conservadas por identidad, cancelado bloquea publicación; unidad/PG                        |
| CP03 | Worker frente a publicar/iniciar/reasignar/archivar                | bloqueos ordenados; ejecución/publicación iniciadas intactas; PG concurrente                                       |
| CP04 | Odoo repetido/error/429/identidad equivocada                       | sin versión inútil, sin escritura parcial, backoff/recuperación; PG/contrato                                       |
| CP05 | Atención abierta con devoluciones, elegir cash                     | modal con neto; aceptar guarda cobro y entrega juntos, detalle congela descuentos; PG/HTTP/JVM                     |
| CP06 | Cancelar pantalla/modal, fuente cambió o visita/version no vigente | pedido permanece abierto; rechazo íntegro y borrador conservado; PG/Compose                                        |
| CP07 | Doble tap/respuesta perdida/reinicio/concurrencia                  | recibo único/replay antes de versiones; outbox cifrado; PG/HTTP/JVM                                                |
| CP08 | cash/transfer/credit/mixed, cero y precisión                       | total exacto y componentes separados; rechazar inválidos, parcial nuevo o suma incorrecta; unidad/SQL/JVM/mutación |
| CP09 | Pedido pagado en ruta activa                                       | liquidación visible inmediata; Aceptar inicialmente desactivado; HTTP/SSE                                          |
| CP10 | Chofer Liquidar, cancelar/aceptar modal                            | sólo aceptar solicita; liquidador habilitado para ese pedido; PG/HTTP/Compose                                      |
| CP11 | Liquidador aceptar/rechazar/carrera/doble recepción                | rol exclusivo; monto/cliente exacto, CAS y reserva; PG/HTTP/seguridad/mutación                                     |
| CP12 | Ruta completa/antigua/archivada, fechas/monedas                    | historia compatible, solicitudes por ruta requieren cierre, métricas sin duplicar; PG/regresión                    |
| CP13 | Última entrega antigua sin cobro                                   | recuperación del cobro; bodega/cierre bloqueados hasta guardar; servidor/JVM                                       |
| CP14 | UI móvil, letra grande, fotos y reconexión                         | importe verde y Liquidar amarillo, detalle legible; instrumentación compilada y QA física del propietario          |

## Puertas y operación

Unidad, PostgreSQL real, contrato HTTP/E2E real, Gherkin, cobertura dirigida
objetivo >=95% y mutación >=90% con cada invariante crítica ejercitada. Métricas:
latencia worker/comando, errores, cambios útiles, componentes por moneda,
complejidad y defectos encontrados. Typecheck/lint/build/audit/bundle/APK y
regresión tras estabilizar. No pruebas con proveedores simulados. QA Android
física conserva la excepción expresa vigente a cargo del propietario.

Referencias inspeccionadas: módulos reales citados arriba, esquemas34..38,
driver-service-context, driver-order-command, payment-policy, finance-context,
guía instalada Next16.3.8 Route Handlers, políticas Android/Compose existentes.
No secretos/IDs/hosts de negocio en código; sólo Ana Rutas, develop; despliegue
manual por el propietario. Rollback de servidor debe aceptar esquema nuevo;
recibos y solicitudes son inmutables, sin downgrade destructivo.

Auditoría local: GREEN LIGHT; INTEGRITY TOTAL al sustituir explícitamente el
orden anterior; MATCH PERFECT con CP-T01..05 en PROGRESS.
