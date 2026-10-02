# BL190 — continuación y reintentos elegidos por el chofer

Bloque aprobado2026-10-02. El usuario exige conservar el funcionamiento actual:
se añaden avisos y accesos; no se modifica ninguna operación de servidor.

## Autopsia y referencias

StopContinuationPolicy ya ordena por posición y omite terminales. Antes también
elegía reintentos al volver a pendientes anteriores. El usuario ahora exige que
el chofer los elija. CollectionPaymentSheet depende de una lectura financiera
posterior al POST; DriverFinanceModel ignora el ID del recibo aceptado.
RouteExecutionModel.collectionConfirmed pierde el evento si loadLocked falla.
Son desconexiones de presentación demostradas en código; no se afirma haber
reproducido un fallo de red en el teléfono del propietario.

Se reutilizan POST payments (respuesta real id/duplicate), ejecución y plan con
revisiones coherentes, menú Tus paradas, StopAttentionSheet y navigateToStop.
Sin cambios a servidor, DB, outboxes, GPS/llegadas, reprogramación, liquidación,
autenticación, permisos ni reglas de regreso a bodega.

Referencias oficiales consultadas: [efectos Compose](https://developer.android.com/develop/ui/compose/side-effects),
[ViewModel](https://developer.android.com/topic/libraries/architecture/viewmodel).
LaunchedEffect emite una acción identificada; ViewModel retiene el aviso durante
rotación. La persistencia de comandos existente sigue perteneciendo al servidor
y al outbox; este aviso no envía comandos. Reinicio de proceso conserva el
contrato NC05 existente: estado manual real, sin promesa de popup durable.

## Matriz y tareas

Actor de todos los casos: chofer autorizado sobre su ejecución. Lecturas:
recibo de pago, ejecución y plan. Escrituras nuevas: ninguna; sólo estado UI.
Efectos: modal/acceso por acción explícita. Auditoría: las operaciones existentes.

| ID   | Precondición / disparador                                           | Resultado                                                         | Validación / fallo seguro                      |
| ---- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| CN01 | Cierra1 con2 pendiente                                              | Ofrece2 y botón Ir                                                | JVM/Compose; no guía sin clic                  |
| CN02 | 3 entregada antes, cierra2                                          | Ofrece4                                                           | JVM; posición publicada, no orden de lista     |
| CN03 | Atendió fuera de orden y quedan normales anteriores                 | Vuelve a la primera normal elegible                               | JVM; ninguna parada normal olvidada            |
| CN04 | Sólo quedan closed_pending, incluso parada actual o sin coordenadas | Aviso y Elegir reintento                                          | JVM/Compose; sin elección ni bodega automática |
| CN05 | Elige reintento, se actualiza estado                                | Menú lee pendientes actuales; abre atención existente             | Contrato UI y QA; no inventa llegada/entrega   |
| CN06 | Pago aceptado y falla lectura financiera                            | ID real sigue disponible para enlazar aviso                       | Política de recibo/JVM; ningún POST adicional  |
| CN07 | Falla refresco operativo o revisiones incoherentes                  | Retiene recibo hasta lectura verificada                           | JVM de cola; misma lectura/sync existentes     |
| CN08 | Rotación, replay o reapertura del recibo                            | Un aviso por recibo y ejecución                                   | JVM/Compose; cerrar no navega ni repite        |
| CN09 | Sesión/ruta retirada o executionId distinto                         | Descarta aviso ajeno; acciones deshabilitadas                     | JVM y regresión permisos PG/HTTP               |
| CN10 | Varios pedidos, cobro pendiente, reprogramado, rechazo, sin punto   | Completar todos para aviso de entrega; reglas previas conservadas | JVM/PG; bodega sólo por WarehouseReturnPolicy  |

CN-T01 implementa CN01..05; CN-T02 CN06..10; CN-T03 prueba todos los casos.
GREEN LIGHT / INTEGRITY TOTAL / MATCH PERFECT: NC02,05,06 y las reglas financieras
se mantienen. NC04 cambia sólo sugerencias automáticas según aprobación.

## Calidad, seguridad y recuperación

Objetivo100% líneas y ramas de nuevas políticas puras por riesgo de destino
incorrecto/recibo perdido. Mutación de orden, filtro, identidad, descarte y
consumo. Regresión JVM completa; PG/HTTP real de cobro/entrega/reintento y
aislamiento, sin mocks. Instrumentación Compose compila; ejecución física bajo
la excepción previamente aprobada. No se presenta compilación como E2E móvil.
Registrar fallos, tiempos de QA, conteos, cobertura y complejidad de decisiones.
No se define SLO nuevo ni se afirma medir latencia móvil sin teléfono.

Revertir únicamente este bloque restaura la presentación anterior sin migración
ni pérdida de dinero/historial. APK compatible por firma. Develop, sin deploy.
