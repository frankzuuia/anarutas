# QA — sincronización Odoo y cobro antes del cierre

Alcance BL171..174 / CP01..14. Repositorio Ana Rutas, rama develop, base
99e157b7aec82af13062283e09eb8dfb1a1ef032. Sin modificaciones a Odoo, Five,
Vendedores, main ni configuraciones/despliegues externos. Contratos y autopsia
en CORRECCION-ODOO-COBRO-POR-PEDIDO.md; aceptación en
tests/acceptance-order-collection.feature.

## Resultados y evidencia

| Puerta                          | Resultado                                                                                                                                 | Evidencia local reproducible                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Tipos / lint                    | TypeScript sin errores; ESLint sin errores, un aviso previo en stryker.product-amendments.config.mjs                                      | .local/qa-collection-typecheck-final.log; .local/qa-collection-lint-final.log                                 |
| Build / migración               | Next producción y bundle de migración correctos                                                                                           | .local/qa-collection-build-final.log; .local/qa-collection-migration-final.log                                |
| Cobro, recepción, permisos y PG | 55/55; PostgreSQL real aislado, firmas y fotos privadas reales                                                                            | .local/qa-collection-coverage-final.log                                                                       |
| Odoo/borrador/publicación       | 14/14; locks, cantidades, identidad, no-op, archivo y preservación de rutas iniciadas                                                     | .local/qa-draft-source-coverage-final.log                                                                     |
| Odoo real de sólo lectura       | 1/1 contrato + 1/1 HTTP/worker; pedidos reportados S00092 y S00093 descubiertos por nombre, IDs obtenidos del proveedor                   | .local/qa-collection-odoo-live.log                                                                            |
| HTTP y navegador                | 1/1 sobre Next producción; cobro atómico combinado, transferencia, crédito, cancelación, SSE, recepción individual, ruta completa y roles | .local/qa-collection-http-final.log; .local/qa-settlements/confirmation.png; receiver.png; receipt-mobile.png |
| Regresión de arranque corregida | 19/19, cinco archivos                                                                                                                     | .local/qa-collection-regression-repair.log                                                                    |
| Regresión general               | 894 aprobadas, cero fallos, tres omisiones externas; 84 archivos aprobados, 889.10s                                                       | .local/qa-collection-regression-final.log                                                                     |
| JVM y Android lint/build        | 131/131; APK e instrumentation APK compiladas; ejecución física pendiente del propietario                                                 | .local/qa-collection-android.log; XML de Gradle                                                               |
| Mutación monetaria/rol          | 254/255 detectados, 99.61%; único superviviente equivalente: typeof method redundante con includes                                        | reports/mutation/payments.json                                                                                |
| Mutación de origen/arranque     | 139/139 detectados; 100%, sin supervivientes                                                                                              | reports/mutation/draft-source.json                                                                            |
| Mutación PG de origen           | 9/9 detectados, incluyendo bloqueo de arranque obsoleto                                                                                   | reports/mutation/draft-source-integration.json                                                                |
| Mutación PG financiera          | 20/20 detectados; baseline 15/15, sin fallos                                                                                              | reports/mutation/settlements-integration.json; .local/qa-collection-pg-mutations-resumed.log                  |
| Mutación Android monetaria      | 22/22 detectados                                                                                                                          | .local/qa-collection-android-mutations.log                                                                    |
| Dependencias productivas        | npm audit --omit=dev: cero vulnerabilidades conocidas reportadas                                                                          | .local/qa-collection-audit-final.log                                                                          |
| Secretos                        | 787 archivos versionables/clientes sin la clave Odoo; 14 assets cliente sin secretos del preview; archivo privado de QA retirado          | .local/qa-collection-secret-scan.log; .local/qa-collection-metrics-final.log                                  |

La cobertura dirigida financiera mide 251/252 líneas (99.60%), 244/247 ramas
(98.78%) y 68/68 funciones. Origen y publicación: 61/61 líneas, 71/72 ramas y
25/25 funciones. DriverPaymentPolicy, WarehouseReturnPolicy y
DriverServicePolicy tienen respectivamente 31/31, 22/22 y 26/26 líneas cubiertas
según JaCoCo. Estos porcentajes corresponden al alcance indicado y no representan
la cobertura completa del repositorio.

El objetivo de líneas >=95% y mutación >=90% se justifica por riesgo monetario.
Se prueban explícitamente fuente vencida/base distinta, visita y revisiones,
permiso exclusivo, separación de componentes, precisión monetaria, fallo del
INSERT con rollback total, idempotencia, carrera de recepción, datos SQL no
finitos, tampering, fotos y migraciones repetidas. La migración 38→39 reconstruye
componentes de recibos históricos de los tres medios sin cambiar montos, hashes,
notas, evidencias ni recepciones aceptadas. Recibos v1 parciales permanecen
compatibles; nuevas capturas v2 exigen el importe completo.

La regresión inicial encontró seis fallos por la nueva comparación de publicación
al arrancar: se estaban comparando también metadatos y la secuencia del borrador.
La corrección comprueba pedidos asignados y partidas vigentes por identidad,
mantiene la secuencia publicada y el contrato de nombre del plan, y preserva la
guarda de fecha. Los 19 casos afectados pasan; modificaciones de cantidades,
partidas, cancelación o asignación impiden iniciar una publicación obsoleta.

Una interrupción de la sesión cortó la ejecución de mutación financiera. Se
recuperaron diez resultados con fallos de aserción comprobados en sus reportes
JSON, después de comparar 176 archivos de entrada con el código actual. Se
ejecutó nuevamente la baseline de 15 pruebas y los diez casos restantes en un
entorno aislado. El reporte final conserva la procedencia y el SHA256 de las
entradas verificadas; los veinte casos detectan la alteración deliberada.

La regresión general no carga credenciales externas. Su caso financiero con
Odoo se ejecutó y aprobó por separado, junto con el recorrido HTTP/worker real.
Permanecen las dos omisiones externas previas: imágenes reales Odoo en
product-thumbnails.test.ts y OAuth/FCM real en route-push.test.ts. No se han
modificado esos módulos ni se atribuye evidencia del proveedor a pruebas locales.

## Métricas y límites de medición

AST de funciones con nombre: 576 funciones core, complejidad estimada máxima 30
(calculatePayment), observedDraftShipment 9, refreshDraftSourceShipments 6,
routePublicationSourceChanged 3, applyDriverOrderAction 13. Es una estimación con
callbacks anidados excluidos, no una certificación de complejidad de toda la app.
Los caminos monetarios de esa función se validan mediante unidades y mutación.

Latencia HTTP de liquidación: 23 mediciones, p95 106.3ms, máximo 151.1ms;
.local/qa-settlements/timing.json.
Es una muestra local con PostgreSQL aislado y Next producción; no prueba de
carga ni SLO de una instalación remota. Errores inesperados del recorrido final:
cero. Los rechazos de autenticación, rol, referencia o importe inválido son
resultados esperados de seguridad, no errores del recorrido.

La actualización Odoo usa el worker existente: RUTAS_FINANCIAL_POLL_SECONDS,
60s por defecto, con lote y backoff en runtime. No se promete notificación
instantánea ni webhook; una validación aparece en la siguiente observación
exitosa y el evento SSE refresca el panel abierto. Si ocurre al borde del ciclo,
el siguiente intento se programa por objetivo, por lo que puede tardar dos
intervalos más la lectura o más si hay cola/fallo del proveedor. No exige
reimportar. Las rutas iniciadas conservan su operación; los recibos guardados
congelan la evidencia financiera original.

## Reproducción

Desde la raíz del repositorio:

```powershell
npm run typecheck
npm run lint
npm run build
npm run bundle:migration
npm audit --omit=dev
npx vitest run --config vitest.settlements.config.ts --coverage
npx vitest run --config vitest.draft-source.config.ts --coverage
npx stryker run stryker.payments.config.mjs
npx stryker run stryker.draft-source.config.mjs
node scripts/verify-settlement-mutations.mjs
node scripts/verify-draft-source-mutations.mjs
npx playwright test tests/e2e/settlements.spec.ts
npm test -- --reporter=dot
node --import tsx scripts/quality-metrics.ts
```

Para proveedor real, configurar ODOO_* y RUTAS_TEST_FINANCIAL_TARGETS (JSON de
pickingId/orderId/partnerId obtenidos del origen), y RUTAS_QA_ORDER_DATE en el
proceso local de QA. Ejecutar financial-odoo-live.test.ts y
tests/e2e/financial-source-live.spec.ts. La evidencia indicada usó la misma
configuración Odoo de develop, leída sin modificarla, y un archivo privado fuera
del repositorio. La prueba HTTP introduce un snapshot viejo únicamente en su
PostgreSQL temporal y verifica que el worker lo restaure; no modifica Odoo.

Desde driver-app, con el SDK Android local configurado:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\scripts\verify-payment-mutations.ps1
```

## Artefacto y QA física del propietario

.local/releases/ana-rutas-driver-0.8.11-cobro-por-pedido.apk, versionCode33,
minSdk26, targetSdk36. Firma APK v2 verificada, mismo certificado de las versiones
anteriores: f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35.
SHA256: 1BA578B000F1FC5BC34355E71C3A5033E3C6EB4A9ABFD9DBEACCF0879983FB5B.
Actualizar la app conservando datos. Servidor develop debe desplegarse primero
para aplicar automáticamente el esquema39 y luego instalar esta APK.

La ejecución instrumentada física/GPS/Google Navigation queda con el propietario,
según su excepción explícita previa. Compilar las pruebas Compose no equivale a
haberlas ejecutado. QA presencial:

1. Con panel abierto y pedido aún sin iniciar, validar pesos/productos en Odoo;
   esperar la lectura automática y comprobar estado/partidas sin Cargar pedidos.
2. Confirmar atención con devoluciones: debe abrir cobro con el neto oficial;
   cancelar pantalla y modal conserva el pedido abierto.
3. Probar efectivo, transferencia, crédito y combinado; en combinado introducir
   ambos importes positivos cuya suma sea el neto. Revisar tarjetas con letra grande.
4. Aceptar cobro: se cierra este pedido y aparece en Liquidación con ruta/fecha,
   cliente/folio, medio e importe. El detalle conserva original − devolución = neto.
5. En la cuenta de liquidación comprobar la tarjeta durante la ruta activa y
   Aceptar desactivado. La cuenta de rutas conserva su restricción de recepción.
6. Chofer Liquidar → modal cancelar/aceptar. Sólo aceptar habilita la recepción
   de ese pedido; confirmar mismo cliente/folio/medio/importe en la cuenta receptora.
7. Repetir tocar, cortar/reconectar red y reabrir: no duplicar cobro ni recepción.
8. Recuperar una entrega antigua con cobro pendiente; no ofrecer cierre/bodega
   hasta guardar el cobro. Con todos atendidos y cobrados, comprobar GPS real y cierre.

No se ejecutó despliegue, instalación física, ni migración de una base externa.
El esquema39 es aditivo y conserva contratos históricos; no bajar esquema ni
eliminar recibos para volver a una versión anterior. Ante rollback de servidor,
usar una versión que conozca los nuevos recibos/componentes.
