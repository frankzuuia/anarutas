# Bloque 3A — pedidos surtidos y flota del día

Autorización: «ok dale para traer los pedidos». Desarrollo local en develop;
promoción/deploy requiere autorización. Odoo sólo lectura.

## Reglas BL-011..014

- BL-011: administrador carga salidas de almacén validadas (`stock.picking`,
  `state=done`, `picking_type_code=outgoing`, destino cliente), enlazadas mediante
  movimientos/líneas a ventas. En este negocio done significa surtido, no entrega
  física al cliente. Sólo cantidades realmente realizadas positivas, sin retornos.
- BL-012: identidad única plan + origen + picking + pedido. Varios pedidos del mismo
  cliente y surtidos parciales independientes se conservan. Cada registro tiene
  dirección del destinatario, líneas, fecha validada y promesa si existe.
- BL-013: el administrador selecciona flota disponible para el plan. Incorporación
  por lotes atómica con auditoría y bloqueo de plan. Reintentos preservan datos,
  asignación y orden. El mismo surtido puede participar en varios planes y cada
  copia se edita de forma independiente; sólo se evita duplicarlo dentro del mismo
  plan. Ediciones de flota/asignación usan versión; eliminación devuelve sus pedidos
  a sin asignar.
- BL-014: ventanas y prioridad nullable pendientes, nunca inferidas ni tomadas de
  la prioridad de almacén. Futuro archivo vinculado por ID de destinatario/origen.
- BL-015: el administrador puede solicitar uno o varios folios de venta exactos
  con prefijo `S` para recuperar sus surtidos validados aunque `date_done` quede
  fuera de la fecha seleccionada. La excepción omite únicamente la fecha: conserva
  empresa, estado done, salida a cliente, cantidades positivas y exclusión de
  devoluciones. El lote se valida completo antes de persistir y nunca escribe Odoo.
- BL-016: el administrador puede quitar una tarjeta del borrador después de una
  confirmación explícita. La eliminación es local, versionada, transaccional y
  auditada; no elimina ni modifica la venta o el surtido en Odoo. Una carga posterior
  normal o manual puede recuperar el pedido, funcionando como reversión operacional.
- BL-017: el administrador puede borrar un plan completo después de una confirmación
  explícita. La operación exige la versión vigente, elimina transaccionalmente sólo
  sus pedidos y selección diaria de camionetas, conserva flota, choferes, usuarios,
  auditoría y Odoo, y registra las cantidades retiradas.

## Fechas y alcance

El modal muestra una sola Fecha de validación de pedidos, propone por defecto el
día local actual de la zona horaria de instalación y permite modificarlo. El cliente
envía esa fecha como inicio y fin del mismo día; el servidor la convierte a límites
UTC [inicio, día posterior) y no acepta fechas posteriores al día del plan.
No hay calendario laboral/corte acordado: no se inventan feriados o aplazamientos.
La fecha explícita evita incorporar todo el histórico al arrancar. Fechas prometidas
se muestran para revisión: aún no hay despacho ni optimización automática.

## Contratos e integridad

Migración aditiva v3: route_order_source, route_plan_vehicles, route_shipments.
Migración v4: sustituye la unicidad global de surtido+venta por unicidad dentro del
plan; no borra ni mueve registros existentes.
Fuente fijada a fingerprint de URL/base/empresa al primer guardado; un cambio de
origen con datos requiere reconciliación, nunca combina IDs de Odoos diferentes.
GET /api/plans/[id]/orders devuelve tablero y versión.
POST /api/plans/[id]/orders lee un lote Odoo y lo incorpora; cursor/techo sólo
acotan lectura, nunca controlan modelo/credenciales. El navegador recorre lotes y
reintenta desde cero después de fallo; restricciones DB impiden duplicación.
PUT /api/plans/[id]/vehicles selecciona flota con expectedVersion.
PATCH /api/plans/[id]/orders mueve un envío con expectedVersion y vehículo elegido.
POST /api/plans/[id]/orders/manual consulta un lote acotado de folios exactos y sólo
lo incorpora cuando todos tienen al menos un surtido elegible. DELETE
/api/plans/[id]/orders retira una tarjeta concreta con expectedVersion; normaliza el
orden restante y permite que una importación posterior vuelva a incorporarla.
DELETE /api/plans/[id] elimina el borrador completo con expectedVersion, dependencias
locales conocidas y auditoría, sin modificar entidades maestras ni Odoo.
Cookies/autorización/CSRF/JSON/SQL parametrizado heredan controles existentes.
Se revalida actor activo en transacción y company/lang desde cuenta Odoo.
Cambios detectados en un surtido ya importado se reportan para revisión, conservando
su contenido y asignación. No se interpreta cancelación o devolución como reenvío.

## Extensión 3C — evidencia local

La carga manual por folio y el retiro recuperable están implementados y validados
localmente. Resultados, métricas, capturas y puerta Odoo live pendiente se registran
en `QA-BLOQUE-3C-PEDIDOS-MANUALES.md`.

## Escenarios / tareas O-T01..05

| Caso                                          | Resultado y validación                               |
| --------------------------------------------- | ---------------------------------------------------- |
| O01 validado hoy, creado antes                | Se usa date_done; prueba live lectura                |
| O02 dos pedidos mismo cliente / parcial       | Identidad por picking+venta, DB real                 |
| O03 recarga / dos admins / dos planes         | Único por plan; copias independientes y concurrencia |
| O04 fallo de red entre lotes                  | Lotes previos persistidos, reintento sin duplicar    |
| O05 ventana/prioridad ausentes                | null visible, no inventar horario ni alta            |
| O06 empresa ajena/config distinta             | Rechazo de permisos y origen, ninguna mezcla         |
| O07 selección inactiva/versión vieja          | Rechazo transaccional, actualizar antes de decidir   |
| O08 quitar vehículo con pedidos               | Vuelven a sin asignar en misma transacción           |
| O09 sin sesión/CSRF                           | 401/403, integración HTTP real                       |
| O10 DST/límites de día/rango inválido         | Unidades y fronteras UTC                             |
| O11 esquema incompatible/respuesta incompleta | Error explícito, lote no guardado                    |
| O12 folios exactos fuera de fecha             | Lote completo, sólo elegibles y sin duplicación      |
| O13 folio inexistente o sin surtido válido    | Rechazo total identificado; cero inserciones         |
| O14 quitar, cancelar y recargar pedido        | Borrado local recuperable mediante nueva carga       |
| O15 botones de carga independientes           | Fecha guarda flota+carga fecha; manual sólo folios   |
| O16 mismo pedido en varios planes             | Se incorpora en todos, sin duplicarse dentro de uno  |
| O17 borrar plan / versión obsoleta            | Confirmación, borrado atómico o conflicto sin daño   |
| O12 fuente corregida después de importar      | Detectar diferencia, no sobrescribir operación       |
| O13 migrar v1/v2                              | Conserva cuentas/flota/planes; PostgreSQL real       |
| O14 varios navegadores/refresh                | Lectura de tablero con versión coherente, E2E        |

O-T01 esquema y contratos (O02..08,13). O-T02 conector real (O01,06,10..12).
O-T03 APIs/UI (O03..09,14). O-T04 QA/cobertura/mutación/aceptación (todos).
O-T05 documentación de evidencia y límites, revisión de diff.

## Referencias y veredicto previo

Esquema live verificado: vegetables3 saas~19.4+e; stock.move.quantity/uom_id,
sale_line_id; picking.date_done/state/partner_id; sale.order.commitment_date.
Usuario de integración lang=es_419. Siete salidas done para cinco clientes.
Fuente oficial: https://github.com/odoo/odoo/blob/19.0/addons/stock/models/stock_picking.py
y stock_move.py. Next instalado: docs route.md (params Promise, handlers dinámicos).
GREEN LIGHT para implementación local. MATCH PERFECT: BL-011..014/O01..14 con
O-T01..05. QA pendiente; no certifica despliegue. Backup productivo y optimización
permanecen fuera de este bloque.
