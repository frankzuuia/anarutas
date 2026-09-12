# Selección de salidas validadas y pendientes

Autorización: ejecutar plan completo en develop por bloques; sin promoción.
Extiende BL-011/013 y S27 únicamente para carga ordinaria; BL-015 manual intacta.

## Evidencia y capacidades

2026-09-11: lectura de ana-rutas-develop/app, Odoo saas~19.4+e. S00012 y
S00013: picking done con date_done hoy. S00014: venta sale, picking assigned,
date_done=false, scheduled_date hoy, tres movimientos assigned con demanda
positiva (1,1,2) y sin devolución. Se cierra la falta de muestra pendiente
registrada en AUTOPSIA-SELECCION-PEDIDOS-ODOO.md. Cero escrituras Odoo.

Referencia oficial 17 (no reemplaza preflight live de producción):
https://github.com/odoo/odoo/blob/17.0/addons/stock/models/stock_move.py
https://github.com/odoo/odoo/blob/17.0/addons/stock/models/stock_picking.py
17 dispone de quantity/product_uom_qty/product_uom; 19.4 observado dispone de
quantity/product_uom_qty/uom_id. fields_get selecciona por tipo/relación, nunca
por versión. quantity_done permanece fallback existente; no mezclar product_qty
(unidad base) con la unidad de movimiento. date_done/scheduled_date se negocian
como datetime. Retornos: origin_returned_move_id y return_id si existe.
Estado venta permitido se intersecta con selection real (sale; done si existe).
Picking: done/confirmed/assigned, waiting excluido hasta evidencia operativa.

## Reglas BL-041..047

Actor común: administrador activo, instalación dedicada, fuente configurada
en servidor. Toda confirmación audita actor, plan, fuente y conteos sanitizados.

- BL-041: fecha+flota → consultar Odoo → lote durable inmutable. No modifica plan,
  pedidos, flota, clientes ni ruteo. Permite escrituras de lote/sesión/rate limit.
- BL-042: done usa date_done y cantidad ejecutada; pendiente confirmed/assigned
  usa scheduled_date y demanda. Sólo salida a cliente/empresa/venta confirmada,
  sin retornos ni líneas canceladas/no positivas. UTC desde zona de instalación.
- BL-043: seleccionar explícitos o all_except sobre todo el lote; búsqueda y
  filtro no alteran significado de seleccionar todos. Selección cero rechazada.
- BL-044: confirmar relee todo seleccionado; si falta/cancela/cambia identidad,
  destinatario o deja de ser elegible, conflicto total. Pendiente→done aceptado
  si nueva fecha sigue elegible. Fallo Odoo: cero mutación del plan.
- BL-045: una transacción bloquea plan y lote; verifica actor/fuente/expiración/
  versión, guarda camionetas y sólo selección, sube versión una vez, audita y
  consume lote. Repetición exacta devuelve recibo; selección distinta tras consumo
  rechazada. Unicidad plan+source+picking+order permanece.
- BL-046: actualizar sólo estado/fechas/líneas Odoo, conservar entidad, cliente
  operativo, notas, ventanas, prioridad, posición y asignación. Cambios de flota
  explícitos mantienen semántica de desasignar unidades retiradas.
- BL-047: estado separado de prioridad; pendientes admitidos en rutas con aviso.
  Manual independiente, mismo pedido en otro plan permitido, recuperar tras borrar.

## Especificación técnica y límites

Snapshot extiende estado original/normalizado, scheduledAt, sourceUpdatedAt y
validatedAt nullable. Compatibilidad histórica: ausencia de estado equivale a
validado. Migración v9 aditiva para route_order_batches, backfill JSON sin quitar
claves. El código viejo puede leer históricos; después de guardar pendientes no
es seguro volver a un binario que exige validatedAt string: rollback de aplicación
requiere conservar datos y una versión compatible, nunca borrar pendientes.

Lote: UUID, actor FK, plan FK ON DELETE CASCADE, fingerprint, fecha, versión,
flota, entradas JSON con UUID opaco y hash, query hash, expiración, receipt/hash.
Expiración y máximo candidatos configurables (protección técnica explícita).
Limpieza automática al consultar; recibos retenidos adicionalmente para reintentos.
No conexión a PostgreSQL de Five. Sólo PostgreSQL local aislado para QA.

POST /api/plans/[id]/orders/candidates crea lote completo; dominio paginado por
ID con techo, sin confiar en cursor/techo del navegador. Si excede máximo devuelve
error, nunca lote parcial. POST /orders/confirm recibe lote/version/flota/selection.
Lectura externa fuera de transacción; aplicación atómica con recheck interno.
No existe transacción distribuida Odoo/Postgres: se registra hora de relectura;
cambios Odoo posteriores al último read no se afirman bloqueados.

JSON máximo ajustable sólo por parámetro servidor para estos endpoints; sesión,
Origin exacto, rate limit por actor, UUIDs verificados, modelos/host inaccesibles
desde body. Errores con folios del propio lote, sin PII adicional ni payload RPC.
Request ID compartido en auditoría y respuesta; tiempos Odoo/PG observados.

La UI muestra todos los candidatos del lote, paginación visual y filtros locales,
indeterminado accesible, loading independiente y doble clic bloqueado. Mantiene
selección en error; permite volver/reconsultar. Cancela sin guardar el plan.
No refresco que sobrescriba cambios operativos durante una consulta.

## Matriz de escenarios / correspondencia de QA

Todos: actor autorizado salvo S-SEC, lectura Odoo donde procede, error recuperable
visible; rechazo no escribe dominio. Auditoría consulta/confirmación sanitizada.

| ID  | Precondición / disparador               | Datos y resultado                                                                              | Prueba / recuperación |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| C01 | Fecha con done y assigned / consultar   | lote, cero cambio plan                                                                         | Odoo real + PG diff   |
| C02 | Sin resultados / consultar              | lote vacío, confirmar deshabilitado                                                            | unidad/API            |
| C03 | Selección parcial / confirmar           | sólo seleccionados + flota                                                                     | PG real/E2E           |
| C04 | Todos, desmarcar, filtrar/paginar       | all_except global e indeterminado                                                              | unidad/E2E            |
| C05 | Consumido / repetir mismo request       | mismo recibo, cero duplicados                                                                  | PG concurrencia       |
| C06 | Mismo picking en otro plan              | copia independiente                                                                            | PG regresión          |
| C07 | Cancelado/cambia fecha/retorno/venta    | conflicto entero                                                                               | unidad contrato/PG    |
| C08 | Pending pasa a done elegible            | mismo ID, actualización controlada                                                             | unidad/PG             |
| C09 | Plan modificado por otra sesión         | 409 sin sobrescritura                                                                          | PG/E2E                |
| C10 | Odoo falla/incompleto                   | cero confirmación, selección preservada                                                        | contrato/E2E          |
| C11 | Actor/plan/fuente/lote manipulados      | denegado, no fuga ni cambio                                                                    | seguridad/PG          |
| C12 | Caducidad/tamaño/rate limit             | error explícito y reconsulta                                                                   | unidades/PG           |
| C13 | Fallo SQL tras insertar                 | rollback flota/pedidos/versión/recibo                                                          | PG real               |
| C14 | Histórico/manual/borrar-recuperar       | mismos contratos y preferencias                                                                | regresiones           |
| C15 | Zona/DST/no positiva/unidades distintas | dominio y cantidades correctos                                                                 | unidad/live           |
| C16 | Pending en ruteo/mapa/Excel             | estado visible, no bloqueo                                                                     | unidades/E2E          |
| C17 | Migración v8 y concurrencia             | backfill, ownership y datos intactos                                                           | PG real               |
| C18 | Techo ID/páginas múltiples              | sin duplicar/omitir página                                                                     | unidad/live volumen   |
| C19 | Cambio sólo estado                      | preservar entidad, orden y asignación; mantener sin cambios la política de recálculo existente | PG/regresión          |

## Auditoría y progreso

GREEN LIGHT completado para construcción local con contrato observado.
INTEGRITY TOTAL: extensión acotada de carga ordinaria; manual conserva su
lector. MATCH PERFECT: SC-T01..SC-T07 en PROGRESS cubren BL-041..047 y
C01..C19. Evidencia ejecutada en QA-SELECCION-PEDIDOS-ODOO.md; no certifica
todavía el Odoo 17 real de producción ni volumen live mayor a 50 candidatos.

Puertas de entrega: pruebas unitarias, PG real, live 19.4, API/E2E, Gherkin,
cobertura no inferior a línea base, mutation >=90% crítico o excepciones
documentadas, lint/types/build, npm audit, evidencia de latencia/errores.
Preflight Odoo 17 real antes de producción; no usar secreto de otra app.
Por indicación final del usuario, este bloque no modifica pesos, cantidades,
prioridades, ventanas, optimización, mapa ni fórmulas de ruteo. Sus contratos
existentes se verifican sólo como regresión.
