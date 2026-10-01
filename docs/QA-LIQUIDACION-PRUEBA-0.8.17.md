# Liquidación de prueba sin bodega — 2026-10-01

## Cambio autorizado y causa

BL183/TB01..10, aprobado explícitamente por el propietario para probar ahora
sin ir a bodega. El botón no aparecía porque Android requería completedAt;
política, comando y SQL también exigían cierre operativo. Quitar sólo la
condición visual habría dejado el envío bloqueado.

Esquema41 agrega settlement_require_warehouse boolean NOT NULL DEFAULT false
en la configuración operativa de PostgreSQL. false es la excepción temporal
autorizada para esta entrega; no se cambia ningún radio o requisito GPS.
La migración automática aplica el modo al actualizar el servidor, sin una
variable extra de entorno ni cambios manuales de cuentas.

La lectura devuelve warehouseRequired a la app. Los comandos vuelven a leerlo
bajo FOR SHARE y SQL usa route_settlement_ready de manera independiente.
Sin cierre operativo sólo se habilita cuando todos los pedidos existen,
están entregados y tienen recibos. Una ruta vacía, un pedido abierto,
reprogramado o sin cobro no se puede liquidar completamente en modo de prueba.
Finalizar trabajo conserva la recepción aceptada de todos los recibos,
el propietario/dispositivo y el resumen exacto e inmutable. No se crea un
registro de llegada o de cierre operativo para poder probar.

Android mantiene las acciones al final, debajo de las tarjetas, y muestra
Modo de prueba · liquidación sin regreso a bodega. El panel mantiene su paquete
y tickets; su ayuda refleja la política actual. Cambiar la configuración a true
restaura la condición de bodega y llega a la app por fingerprint/eventos sin
otra APK. No se restaura ahora: falta la confirmación posterior del propietario.
Los reintentos idénticos de operaciones ya confirmadas recuperan su resultado
original incluso tras restaurar la política; no reescriben el historial.

Los triggers comparten sus definiciones con las migraciones previas para evitar
dos versiones divergentes. Sus guardas de identidad, roles, reservas, recibos,
inmutabilidad y totales conservan los contratos anteriores. Los fixtures de
regresión configuran explícitamente true en PG para seguir comprobando bodega.
Las pruebas de la excepción usan false persistido, nunca una bandera del cliente.

## Evidencia

| Puerta | Resultado |
| --- | --- |
| Financiera/PG/contratos | 80/80 aprobadas en la ejecución final, PostgreSQL real |
| Regresión general | 930 aprobadas, 0 fallos, 3 omisiones externas preexistentes; 89 archivos aprobados/1 omitido |
| Política de liquidación/cierre | 115/115 mutaciones detectadas, 0 supervivientes, 0 errores |
| Cobertura política | 100% líneas33/33, ramas28/28, funciones25/25 |
| Cobertura comando de cierre | 100% líneas29/29, ramas18/18, funciones4/4 |
| Cobertura configuración | 100% líneas4/4, ramas2/2, funciones1/1 |
| Cobertura financiera afectada | 99.69% líneas331/332, 98.43% ramas314/319, funciones100%102/102 |
| Modo de prueba y SQL | 7/7 mutaciones detectadas por aserciones PG; baseline2/2 verde |
| Guarda financiera anterior modificada | 1/1 mutación detectada por 4 aserciones; baseline15/15 verde |
| JVM Android | 143 pruebas, 0 fallos, 0 errores |
| Visibilidad Android | 100% líneas1/1 y ramas6/6; 3/3 mutaciones detectadas |
| App/instrumentación Android | Compiladas; lint0 errores/35 avisos preexistentes |
| E2E real HTTP/Chrome/PG | 4 recorridos verdes: recepción individual tras rechazo,50 pedidos, bodega=true y bodega=false |
| E2E final después de ordenar archivo de pruebas | true51.0s / false32.7s aprobados; no cambia implementación productiva |
| Build/typecheck/migrador | Aprobados |
| Lint web | 0 errores/1 aviso preexistente de stryker.product-amendments.config.mjs |
| Dependencias productivas | npm audit --omit=dev: 0 vulnerabilidades |
| Bundle cliente | 14 archivos revisados, sin credenciales privadas locales expuestas |

Métricas locales del E2E de prueba: lectura25 muestras, p95 70ms y máximo153.1ms;
finalización concurrente con el mismo comando46.0123ms/51.9123ms; incorporación
al panel332ms sin desplazar tarjetas, altura285px en la prueba de volumen.
No son prueba de carga ni SLO de producción. Complejidad estimada AST máxima
en funciones nuevas/afectadas de política6, helper de elegibilidad4 y lectura
de configuración2; callbacks anidados excluidos por el método existente.
El máximo global30 es anterior al cambio.

El objetivo en política y guardas nuevas es100% por tratarse de recepción y
cierre; el promedio global no sustituye una rama monetaria o de permiso.
Cobertura SQL se evidencia con integración/mutaciones, no mediante V8.

Las tres omisiones de regresión requieren configuración de servicios externos:
financial-odoo-live (RUTAS_TEST_FINANCIAL_TARGETS), product-thumbnails
(RUTAS_TEST_IMAGE_PRODUCT_ID) y route-push (ANA_RUTAS_LIVE_FCM_QA=1).
No se agregan omisiones ni se simulan esos proveedores para esta entrega.

Defectos detectados antes de cerrar: el comando indicaba nada pendiente cuando
faltaban todos los cobros; se reordenó la validación para conservar la causa
faltan cobros que devuelve la lectura. Dos mutantes de ejecución vacía sobrevivían
porque la prueba sólo comprobaba elegibilidad; la prueba ahora comprueba el
motivo exacto y ambos se detectan. El runner E2E exige destructurar sus fixtures;
se corrigió la extracción de la función de prueba y se repitieron ambos modos.
Android necesitó ANDROID_HOME apuntando al SDK real instalado; no se añadió una
configuración local ni un secreto al repositorio.

Las pruebas también verifican una inconsistencia histórica real de SQL con un
recibo y pedido abierto, cobros faltantes, modo impuesto por cliente ignorado,
restauración, migración40→41 repetida, conservación de true, replay después de
restaurar, recepción completa, concurrencia, un cierre único y ausencia de
registros fabricados de completion operativa.

## Reproducción y evidencia local

Desde la raíz, con dependencias instaladas del lockfile:

```powershell
npm test
npx vitest run --config vitest.settlements.config.ts --coverage
npx stryker run stryker.route-work.config.mjs
node scripts/verify-warehouse-mutations.mjs
node scripts/verify-settlement-mutations.mjs
npm run typecheck
npm run lint
npm run build
npm run bundle:migration
npx playwright test tests/e2e/settlements.spec.ts tests/e2e/settlement-volume.spec.ts tests/e2e/route-individual-reception.spec.ts
node --import tsx scripts/quality-metrics.ts
npm audit --omit=dev --json
```

Desde driver-app con ANDROID_HOME configurado al SDK instalado:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\scripts\verify-financial-mutations.ps1 -Scope settlement
```

Logs .local/qa-settlements/warehouse-*.log; resultados de mutación
reports/mutation/route-work.json, warehouse-integration.json y
warehouse-previous-guard.json; cobertura
coverage/settlements y driver-app/app/build/reports/coverage/test/debug/report.xml.
Los mutantes se ejecutan en copias descartables con ruta de limpieza validada.
La guarda finished-route del script financiero anterior se ejecutó de nuevo
de forma aislada sobre sus 15 pruebas reales; las otras 19 conservan la evidencia
verde de FW-T04 porque no cambiaron. El comando publicado reproduce las 20.
No se simulan proveedores ni se escribe en Odoo/Google. La prueba SQL de
inconsistencia sólo altera y restaura su registro dentro del PostgreSQL aislado.

## APK y comprobación física

.local/releases/ana-rutas-driver-0.8.17-prueba-sin-bodega.apk;
0.8.17/code39, minSdk26, 69,147,470 bytes. SHA256:
DBF920838ECAE8DF9C75B2FF0D91B410F60643B4B56826A9C580D3720AC7B4A3.
Firma verificada; mismo certificado SHA256
f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35.
Actualizar conservando los datos; no hace falta desinstalar.

La instrumentación está compilada, no ejecutada en teléfono. Sigue vigente
la excepción física aprobada por el propietario el2026-09-30. QA después de
su deploy manual de develop:

1. Instalar actualización0.8.17, entrar a Liquidación y abrir la ruta actual.
2. Debajo de los pedidos ver modo de prueba y Liquidar toda la ruta, sin
   regresar a bodega ni pulsar Terminar ruta. Si quedan entregas/cobros, bloquear.
3. Revisar el paquete: Cancelar no envía; Aceptar envía una vez.
4. En cuenta liquidadora, abrir tarjeta del paquete, consultar tickets y
   cancelar recepción sin habilitar cierre de trabajo.
5. Aceptar recepción; app actualiza, habilita Finalizar trabajo y muestra
   Buen trabajo con entregados/incidencias/monto reales al confirmar el cierre.
6. Reabrir, interrumpir conexión/reintentar y comprobar el mismo resumen sin
   duplicados. Probar Atrás, texto ampliado y cincuenta pedidos en el modal.
7. Cuando el propietario confirme volver a bodega, restaurar la configuración
   en servidor y verificar bloqueo antes de cierre GPS con la misma APK.

Entrega sólo develop bajo autorización permanente. Sin deploy ni escritura en
main. No se declara certificación física o de producción por compilar Android.
