# Liquidación clara y verificación del refresco automático

Estado: aprobado por el propietario el 2026-10-01, con la aclaración de mostrar
en liquidación móvil sólo pedidos entregados y con cobro confirmado.
Base: develop, 5f1703abcb43ead06740954ee012903b8778fd8b.

## Diagnóstico comprobado

1. El trigger `track_shipment_finance` registra el seguimiento al importar un
   pedido. `dueFinancialTargets` selecciona pedidos de planes no archivados sin
   exigir vehículo. `refreshDraftSourceShipments` admite vehículo nulo; excluye
   carriles que ya iniciaron. Asignar un pedido no consulta Odoo ni lo valida.
2. Al actualizar el snapshot, el worker incrementa la versión del plan y las
   notificaciones PostgreSQL llegan por SSE. Dashboard actualiza la versión del
   tablero y OrdersBoard vuelve a leer sus pedidos. Actualizar hace esa lectura,
   no una consulta forzada a Odoo. Las pruebas existentes cubren borradores sin
   asignación en PG, pero falta una aserción explícita del DOM abierto en ese
   mismo recorrido del worker con proveedor real.
3. Lectura de EasyPanel el 2026-10-01: servicio `ana-rutas-develop/app`, commit
   desplegado igual a la base; ninguna variable RUTAS_FINANCIAL_* configurada.
   Aplica pollSeconds=60. Los últimos doce eventos financieros inspeccionados
   fueron exitosos, con siete objetivos y lecturas de 2.0–3.5 segundos. Los logs
   disponibles no llevan timestamps por pedido: no prueban la causa del retraso
   concreto de S00096. No atribuirlo a la asignación por una coincidencia visual.
4. El temporizador despierta cada 60 segundos y cada objetivo vuelve a ser
   elegible 60 segundos después de persistir. Al exceder ese instante el siguiente
   tick puede esperar otro ciclo: esperar aproximadamente 1–2 minutos en el caso
   normal; colas, desconexiones o backoff pueden prolongarlo. El panel visible y
   conectado debe reflejar el cambio automáticamente al recibirlo.
5. SettlementPanel y DriverFinanceScreen imprimen decimales JSON directamente.
   financialMoney en Android formatea números, pero no incluye símbolo monetario.
   Incidencias muestran quantity de PostgreSQL sin quitar ceros sobrantes.
6. Web usa `<details>` y Android inserta FinanceOrderDetail en la misma lista:
   abrir pedidos aumenta el tamaño de la página. MoneySummary imprime bloques
   vacíos y valores cero; los nombres de estados no explican quién tiene el dinero.
7. Hay dos Actualizar: uno del Dashboard y otro del SettlementPanel. El refresh
   del Dashboard no ejecuta una rama para settlements; el botón propio sí actualiza
   el reporte y detalle. Debe quedar una única acción efectiva en esta sección.
8. El total descontado existe por partida y por pedido. No existe actualmente un
   importe separado por incidencia. Multiplicar precio unitario por unidades en
   cada cliente sería incorrecto con descuentos, impuestos y reparto de centavos.

## Diseño y reglas propuestas

Se conserva la identidad visual oscura de Ana Rutas y Five. Se usan sus colores,
tipografía e iconos existentes, superficies compactas y cifras alineadas. La guía
UI/UX se aplica como referencia de accesibilidad y jerarquía; no se adopta su
recomendación genérica de scroll horizontal para este flujo operativo.

### BL-175: refresco independiente de asignación

Actor: administrador de rutas. Pedido importado sin vehículo o asignado a ruta
no iniciada sigue recibiendo estado y partidas reales de Odoo sin reimportación.
Auditar la conexión completa antes de modificar el sincronizador. Añadir prueba
que observa el cambio en el navegador sin click, traslado de pedido ni reload.
Si la prueba encuentra un defecto, corregir su causa conservando límites de RPC,
bloqueos, backoff, publicaciones iniciadas e historial.

Datos/permisos: mismos snapshots y permisos routes. Sin escrituras en Odoo ni
configuración remota. No presentar En vivo como garantía de una lectura Odoo
instantánea. Si se incorpora estado de sincronización, derivarlo de la última
lectura real y de la configuración runtime, nunca de un temporizador decorativo.

### BL-176: dinero y cantidades legibles

Actor: chofer y liquidador. Importes MXN: `$1,086.50 MXN`, negativos `−$160.00 MXN`;
cantidades `4 unidades`, `2.3 kg`. Conservar decimales significativos del precio
unitario, precisión exacta de strings/BigDecimal, cero y valores grandes. Monedas
distintas conservan su símbolo y código. Valor desconocido no se convierte en cero.
Aplicar a precios, totales, tarjetas, combinado, confirmaciones, incidencias y
recibos anteriores. No cambiar cantidades, redondeos, cálculos ni payloads guardados.

La proyección del descuento por incidencia es sólo de lectura. Usar identidad
estable (movimiento y línea de venta), estado y cantidades del mismo snapshot
financiero que produce el total. Repartir el descuento ya calculado de cada partida
entre sus incidencias aplicables mediante el asignador decimal existente y orden
estable de IDs. Canceladas no descuentan; reposición pagada completa no descuenta;
reposición con pago posterior se presenta aparte; sin base confiable se indica
importe pendiente de revisión. No cruzar por nombre de producto.

El ajuste de redondeo a nivel pedido se presenta explícitamente cuando sea distinto
de cero y necesario para conciliar partidas, incidencias y total. No inventar un
descuento distinto del recibo. En cobros confirmados usar sus datos congelados,
incluido el histórico, con proyección fuera del hash/basis de comandos. No reescribir
recibos ni forzar una migración de datos por un cambio de presentación.

### BL-177: panel de liquidación

Actor exclusivo: settlement. Un solo Actualizar, filtros de fecha y estado de
conexión. Tres tarjetas por moneda: Efectivo (verde), Transferencias (azul) y
Crédito (violeta). Dentro de cada tarjeta, importe principal y estado claramente
etiquetado: Por liquidar / Enviado para revisión / Recibido por liquidación.
Crédito explica que se registra saldo del cliente; no se suma al efectivo físico.
Combinado aporta sólo su parte correspondiente a efectivo y transferencia.

Rutas en cuadrícula adaptable: nombre, fecha legible, chofer, unidad y conteo de
pedidos. Dentro de una ruta: resumen compacto y tarjetas de cliente/folio con
medio, importe, estado y acciones. Buscar por cliente/folio, filtrar por estado
y paginar la lista para que 50 pedidos no creen una pared de tarjetas abiertas.

Ver pedido abre un modal independiente con encabezado estable, contenido interno
desplazable y cierre visible. Al cerrar se conserva búsqueda, filtro, página y
posición. Contenido: cliente/folio; partidas con precio/cantidad/importes; resumen
original − descuentos − pagos posteriores = neto; incidencias amarillas con nombre,
cantidad, descuento y evidencia; notas del chofer. El recibo confirmado conserva
sus precios aunque Odoo cambie. Confirmar recepción mantiene su modal, importe,
versión, idempotencia y permisos. Abrir o cerrar el detalle no escribe datos.

Ocultar bloques vacíos, historial sin movimientos y saldos cero que no informan.
Cuando existan, explicar «Pendiente por cobro parcial anterior» y «Reposición que
el cliente pagará después». Mostrar historial mediante acceso separado, sin
duplicar la misma solicitud entre tarjetas. Aceptar sigue desactivado hasta que
el chofer confirme Liquidar; recepción global mantiene sus condiciones existentes.

### BL-178: app del chofer

La lista de liquidación sólo incluye pedidos entregados con cobro confirmado;
se incorporan automáticamente al terminar el cobro. Pedidos abiertos y entregas
históricas sin cobrar conservan la atención desde la operación de la ruta.
No filtrar el endpoint compartido usado por CollectionPaymentSheet para cobrar.
Misma jerarquía, formato e incidencias que web. Resumen de ruta con tarjetas de
Efectivo / Transferencias / Crédito y estados claros; no listas de frases sueltas.
Tarjeta de cliente compacta, total visible y Liquidar en amarillo. Ver pedido y
cobro abre un diálogo con superficie existente ServiceFormSurface y scroll propio.
Conservar reconexión, estado pendiente, pago histórico sin registrar y volver a
la lista sin perder posición. Evitar diálogos de detalle y confirmación superpuestos.
Soportar letra grande, pantallas pequeñas, teclado y botón Atrás. Datos de recibo
congelados no deben presentarse como precios vencidos por la hora actual.

Ejemplo de las capturas (referencia visual, nunca constante en código):

- ALFALFA KG · Devolución · 4 unidades · −$160.00 MXN, sobre fondo amarillo tenue.
- Original $1,246.50 MXN; descuentos −$160.00 MXN; total $1,086.50 MXN.
- Efectivo por liquidar $1,086.50 MXN. Crédito y transferencia no se mezclan con efectivo.

## Bloques, alcance y aceptación

| Bloque | Archivos principales comprobados | Criterio de cierre |
| --- | --- | --- |
| 1. Sincronización | financial-worker.ts, financial-store.ts, draft-source-sync.ts, Dashboard/OrdersBoard/use-panel-realtime; prueba financial-source-live.spec.ts | Pedido sin asignar se actualiza en DOM automáticamente; asignado igual; iniciado intacto; límites y fallos documentados |
| 2. Presentación financiera | DriverFinancial.kt/Views, contrato/proyección de lectura financiera, financial-allocation.ts como utilidad existente; nuevo formateador compartido web | Dinero exacto legible; reparto de incidencia concilia con descuentos; bases/hashes/recibos sin alteración |
| 3. Panel | settlement-panel.tsx, dashboard.tsx, globals.css; componentes de presentación separados según responsabilidad | Una acción Actualizar, tarjetas compactas, búsqueda/filtros/paginación y modal accesible; Liquidar/Aceptar idénticos |
| 4. Android | DriverFinanceScreen.kt, DriverFinancialViews.kt, RouteServiceSheets.kt y superficies existentes; versión APK | Tarjetas, modal y descuentos equivalentes; sin perder navegación, outbox ni recuperación |
| 5. Verificación/entrega | Gherkin, pruebas unitarias/PG/HTTP/JVM/Compose, reportes y PROGRESS | Evidencia verde aplicable; commit/push develop y APK; despliegue manual y QA física del propietario |

| Caso | Recorrido y fallo relevante | Verificación |
| --- | --- | --- |
| LC01 | Pedido sin asignar pendiente pasa a validado con peso real | Odoo lectura + worker + PG + DOM abierto, sin clicks |
| LC02 | Asignado no iniciado; iniciado; archivado; dos observaciones iguales | Estado correcto, conservación, no-op y regresión |
| LC03 | Evento durante edición o petición, desconexión/reconexión y sesión revocada | SSE y navegador real; sin consultas por navegador a Odoo |
| LC04 | $0, $1,086.50, negativo, precio fraccionario, número grande y otra moneda | Unidades TS/JVM; sin pérdida de precisión ni NaN disfrazado |
| LC05 | Varias incidencias de misma partida, impuestos/descuento/redondeo | Suma exacta, orden estable y mutación del reparto |
| LC06 | Incidencia cancelada, sin partida, reposición pagada o diferida | Etiqueta y monto correctos; sin deducción inventada |
| LC07 | Recibo antiguo, fuente modificada, combinado y crédito | Leer snapshot confirmado; contrato e idempotencia intactos |
| LC08 | 50 pedidos, filtrar/buscar/paginar, abrir y cerrar modal | Lista compacta, foco/scroll restituido, sin movimiento de dinero |
| LC09 | Web teclado/Escape, móvil 375px y letra grande Android | Modal con encabezado/cierre visibles, sin desbordamiento |
| LC10 | Chofer solicita; liquidador recibe; doble click/reintento/cancelar | Permiso exclusivo, importe exacto y evento en tiempo real |
| LC11 | Sin cobros, pendientes, recibidos y saldos históricos no cero | Mensajes comprensibles; no confundir crédito con efectivo |
| LC12 | Pedido abierto, entrega sin cobro, entrega cobrada | Sólo el último aparece en liquidación móvil; cobro operativo y recuperación intactos |

Pruebas: PG y HTTP reales aislados, proveedor real sólo lectura, unidades de
presentación y asignación, regresión afectada, cobertura y mutación de las rutas
monetarias nuevas. QA visual web con capturas verificadas; JVM, lint Android y
APK; Compose compilado y ejecución física con el propietario según excepción
previa. Medir duración y errores del refresco, cobertura, mutantes detectados y
complejidad de utilidades. No declarar proveedor ni dispositivo comprobados con
simulaciones. Si sólo cambia una vista, no repetir pruebas ajenas sin razón.

## Referencias e integridad

- Next instalado: node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md.
- [Diálogos Compose](https://developer.android.com/develop/ui/compose/components/dialog).
- [Elemento dialog y comportamiento modal](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog).
- [Patrones de tarjetas, métricas y modales](https://21st.dev/community/components), inspiración; implementar con el sistema existente.
- Contratos BL171..174 y QA-COBRO-POR-PEDIDO-2026-09-30.md.

Auditoría local de propuesta: GREEN LIGHT para el alcance descrito. INTEGRITY
TOTAL: no cambia quién cobra, cuándo se cierra, quién recibe, la precisión del
dinero ni el historial. MATCH PERFECT con LC01..12 y los cinco bloques anteriores.
Plan confirmado; ejecutar los bloques incluyendo LC12 y validar antes de subir a develop.

Corrección visual del propietario durante QA: eliminar el recuadro verde interior
del monto por pedido. El importe queda integrado en la tarjeta, separado por una
línea discreta, sin altura artificial, tanto en web como en Android.

Segunda corrección explícita del propietario: rehacer el modal como recibo.
Encabezado compacto con cliente, folio y medio; pedido completo con cantidades y
precios; desglose total original, devoluciones, total final y total cobrado (o
crédito); debajo, renglones amarillos por incidencia con producto, cantidad,
descuento exacto y motivo. Sin franja verde ni recuadros rellenos de incidencias.
Los importes siguen saliendo del recibo confirmado y su proyección por identidad.
La tabla conserva su altura intrínseca; el cuerpo del modal desplaza todo el
contenido manteniendo el cierre visible. Regresión geométrica además de visibilidad.

Corrección acotada solicitada después: en el modal web, Cantidad final corresponde
a physicalRemaining del snapshot confirmado, no a quantity original. Ejemplo:
5 de alfalfa con devolución de4 muestra1; el importe original conserva las5 y
el detalle amarillo conserva las4 devueltas. Sin recalcular cobros ni alterar app,
backend, permisos o recibos. Verificar cantidades sin incidencia, devolución
parcial/completa, cantidades fraccionarias y cancelaciones mediante política
existente y regresión de la celda del navegador real.
