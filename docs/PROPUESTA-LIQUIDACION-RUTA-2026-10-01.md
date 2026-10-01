# Cantidad final Android y liquidación completa de ruta

Estado: reglas confirmadas por el propietario el2026-10-01. Liquidar toda la
ruta al regresar a bodega y terminar el recorrido, botón al final de Android;
Finalizar trabajo únicamente después de recepción completa del liquidador.
Base inspeccionada: develop d5a376a, Ana Rutas exclusivamente.

## Autopsia comprobada

DriverFinanceScreen.FinanceOrderDetail toma la fuente de payment.snapshot,
correctamente, pero imprime line.quantity. El mismo contrato ya incluye
physicalRemaining. Web usa este último desde LC-T06. ADES4 con devolución3
conserva cantidad final1, original332.84, descuento249.63 y final83.21.
La cura es leer la cantidad física del recibo; no dividir dinero entre precio.

La liquidación de ruta ya existe: Android envía shipmentId=null a requests.
requestSettlement y el trigger vigente de order-collection-schema exigen cierre
operativo; selected excluye aceptados, exige todos los cobros de entregados y
rechaza si alguno tiene solicitud pendiente. El servidor reserva recibos con
claims únicos y congela IDs/totales. decideSettlement acepta o rechaza una
solicitud en una transacción, con rol settlement, lock de ejecución, versión,
basis, auditoría e idempotencia. Admin sólo muestra la acción de ruta dentro
de Solicitudes e historial; las tarjetas individuales no pueden aceptarla.

## Bloque 1: cantidad final, alcance aprobado de presentación

Android muestra Cantidad final usando physicalRemaining del snapshot confirmado.
Conserva todas las partidas, unidades, precisión, originales/netos y devolución
amarilla. Cantidad cero no se convierte en cantidad original. Importe cero no
implica cantidad cero: descuentos/productos gratuitos mantienen su cantidad.
Unidad JVM, mutaciones de campo equivocado y Gherkin LC17; compilación/lint/APK.
QA física según excepción vigente del propietario. No cambia dinero ni API.

## Bloque 2: liquidación completa, regla confirmada

1. App: acción visible Liquidar toda la ruta al final de la pantalla. Antes de enviar,
   modal con nombre/fecha, cantidad de pedidos, folio/cliente/importe por pedido
   y tarjetas de efectivo, transferencias y crédito por moneda. Ver pedido abre
   el recibo completo con cantidad final e incidencias. Aceptar crea una sola
   solicitud; Cancelar no escribe. Carga, error y envío pendiente son explícitos.
2. El paquete incluye sólo recibos entregados/cobrados todavía sin recepción.
   Excluye los ya aceptados; no modifica solicitudes individuales pendientes.
   Si existe alguna, informa qué pedidos esperan decisión y bloquea otro paquete
   que los duplique. Un rechazo libera reservas y permite volver a solicitar.
3. Servidor publica una previsualización autoritativa de elegibilidad,
   motivo, IDs, importes separados y base revisada. Al enviar, verifica la misma
   base bajo el lock existente; si cambió la selección, exige revisar de nuevo.
   Reintento del mismo comando confirmado devuelve la solicitud anterior.
   Mantener compatibilidad explícita con APK anteriores; no exigir campos nuevos
   a solicitudes históricas ni reescribir snapshots, recibos o decisiones.
4. Cuenta liquidadora: bloque visible Recepción de ruta con estado y acción
   Aceptar liquidación de ruta. Desactivada antes del envío del chofer. Al llegar
   la solicitud, eventos actuales actualizan el panel automáticamente. Modal
   muestra exclusivamente pedidos/importe incluidos en ese paquete confirmado,
   botón Aceptar y Cancelar y nota opcional. Aceptar marca todos esos recibos en
   la misma transacción; todos pasan a Recibidos en ambas pantallas. Historial
   conserva usuario/fecha y exclusiones. Administrador de rutas sin permiso.

El propietario eligió conservar Terminar ruta en bodega, con cierre/GPS y
guardas vigentes. CP12 permanece intacto; reprogramados no inventan cobros.
Liquidación financiera no termina automáticamente el recorrido ni cambia GPS.

## Bloque 3: Finalizar trabajo y Buen trabajo, confirmado

Finalizar trabajo se habilita con ruta terminada, todos los entregados con
recibo y todos esos recibos aceptados por liquidación. También cubre la ruta
recibida mediante solicitudes individuales; no exige liquidar dos veces.
El cierre pertenece al chofer original y es una operación durable e idempotente,
distinta de finalizar el recorrido y de recibir dinero. Se propone una tabla
nueva route_driver_work_completions, esquema40 aditivo, sin actualizar eventos
operativos ni recibos existentes. Unicidad por ejecución y por dispositivo/comando,
snapshot inmutable, trigger de identidad/cierre/recepción, auditoría y evento.

El servidor publica y congela el resumen: número de pedidos entregados,
incidencias activas distintas del snapshot de cada cobro, y monto neto original
de cada recibo (expected) sumado exactamente por moneda. Así monto total incluye
crédito y recibos recibidos anteriormente; no es solamente el efectivo pendiente.
No contar incidencias canceladas, fotografías como incidencias ni reprogramados
como entregados. Mostrar cada moneda separada sin convertir ni sumar divisas.
Los casos históricos parciales conservan su saldo, sin inventar cobros.

Tras respuesta confirmada, modal Buen trabajo muestra nombre/fecha, entregados,
incidencias y monto total de la ruta. Error o respuesta perdida conserva outbox,
sin afirmar éxito hasta recuperar confirmación real. Al volver puede consultar
el mismo resumen de trabajo finalizado. Dos dispositivos cierran una sola vez;
cambio de resumen/base antes de envío obliga a revisar. Evento actualiza ambos
consumidores sin refresco manual; fingerprint móvil incluye el cierre durable.

## Escenarios y evidencia prevista antes de integrar el bloque 2

| Caso | Precondición y evento | Resultado | Evidencia |
| --- | --- | --- | --- |
| LR01 | ADES4 devueltos3 | Cantidad final1, devolución3 y descuento249.63 | JVM/LC17, QA física |
| LR02 | Ruta elegible, varios medios | Un paquete exacto con detalle y confirmación | Política/PG/HTTP/Compose |
| LR03 | Pedido abierto o entregado sin cobro | Elegibilidad conforme a activación aprobada; motivo visible | PG/SQL/contrato |
| LR04 | Un recibo ya aceptado | Excluido del paquete y totales | PG/HTTP/E2E |
| LR05 | Solicitud individual pendiente | No se fusiona ni reserva dos veces; motivo visible | PG/concurrencia |
| LR06 | Cancelar en chofer o receptor | Sin escritura ni cambios de estado | HTTP/E2E/Compose |
| LR07 | Doble envío/respuesta perdida/reinicio | Mismo comando, un paquete; outbox durable | PG/HTTP/JVM |
| LR08 | Selección cambió después del modal | Conflicto antes de reservar, revisar importes | PG/concurrencia |
| LR09 | Dos receptores aceptan/rechazan | Sólo una decisión; ninguno recibe dos veces | PG/HTTP/mutación |
| LR10 | Rechazo y nueva solicitud | Historial intacto, reservas liberadas | PG/HTTP |
| LR11 | Otros roles/otro chofer/sesión revocada | Rechazo autorizado sin fuga de datos | Seguridad/HTTP |
| LR12 | Odoo/incidencia cambia después del cobro | Se conservan recibo y evidencia congelados | PG/regresión |
| LR13 | 50pedidos, fuente/eventos/reconexión | Modal desplazable, pie accesible, actualización automática | E2E/QA física |
| LR14 | Monedas/mixto/crédito/cero | Sumas exactas por moneda, crédito no contado como efectivo | Unidad/PG/contrato |
| LR15 | Actualizar esquema y volver a ejecutar | Conservación histórica y migración repetible | PG/migrador |
| LR16 | Recepción aún pendiente o rechazada | Finalizar trabajo desactivado/rechazado por servidor y SQL | Unidad/PG/HTTP/mutación |
| LR17 | Ruta recibida completamente | Finalizar una vez y Buen trabajo con datos reales | PG/HTTP/Compose/E2E |
| LR18 | Sólo solicitudes individuales aceptadas | Puede finalizar sin duplicar liquidación | PG/contrato |
| LR19 | Doble cierre/dos dispositivos/respuesta perdida | Un cierre durable; replay y outbox recuperables | PG/JVM/HTTP |
| LR20 | Fuente/incidencia cambia después del cobro | Resumen conserva snapshots y precisión | PG/regresión |
| LR21 | Incidencia cancelada o fotos adicionales | No aumenta el contador activo | Unidad/PG |
| LR22 | Recibo aceptado en otra solicitud | Total de ruta lo incluye una vez | Unidad/PG/E2E |
| LR23 | Alterar/eliminar cierre o forzar SQL antes de recepción | Rechazo de integridad | PG/seguridad/mutación |
| LR24 | Reentrada tras finalizar/reinstalar en otro dispositivo autorizado | Mismo resumen consultable | PG/HTTP/QA física |

Objetivos por riesgo: nueva política100% líneas/ramas; servidor financiero>=95%
líneas y mutación>=90%, con todas las guardas críticas detectadas aunque el
promedio sea mayor. Reportar complejidad, fallos, latencia local del comando y
evento, sin convertir una muestra en SLO. Regresión del dominio financiero,
typecheck/lint/build, seguridad y escaneo cliente; nueva APK/firma compatible.
Las pruebas PG/HTTP/E2E usan servicios y bases reales aisladas, sin proveedores
simulados. QA Android física y deploy del propietario según autorización vigente.

Referencias locales inspeccionadas: DriverFinancial, DriverFinanceModel,
DriverFinanceScreen, settlement-panel, settlement-presentation, finance-read,
finance-context, settlements, order-collection-schema, database y escenarios
de integración/E2E existentes. Guía Next instalada Route Handlers16.3.8.
Auditoría local de especificación: reglas de cierre vigentes conservadas,
recepción transaccional reutilizada, nuevo cierre separado e inmutable; no
confundir confirmación de plan con evidencia de implementación. Construcción
por bloques y puertas antes de commit/push; revisión física del propietario.

## Evidencia de implementación

FW-T01..04 terminados; resultados, cobertura, mutaciones, E2E reales,
compatibilidad APK y límites en [QA-LIQUIDACION-RUTA-0.8.16.md](QA-LIQUIDACION-RUTA-0.8.16.md).
El despliegue y la ejecución física Android corresponden al propietario bajo
la excepción vigente; la instrumentación está compilada, no ejecutada.
