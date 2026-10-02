# QA — continuación y reintentos 0.8.20

Fecha 2026-10-02. BL190/CN01..10, bloque aprobado y revisado sin modificar reglas
de entrega, cobro, visitas, GPS, liquidación, permisos o regreso a bodega.

## Resultado y límites

- 161 pruebas JVM, 0 fallos/errores; 18 en los dos contratos directamente afectados.
- StopContinuationPolicy: 16/16 líneas, 36/36 ramas. CollectionContinuationPolicy:
  18/18 líneas,28/28 ramas.100% en ambas; cobertura de políticas puras, no del SDK
  ni de la pantalla ejecutada en teléfono.
- 34/34 mutaciones detectadas. Cada mutación produjo fallos de assertions, no
  sólo un error de compilación; copia aislada restaurada y hashes cotejados.
- 20 pruebas de integración con PostgreSQL real, 4 archivos, 176.11s; 0 fallos.
- 2 recorridos HTTP/navegador reales de cobro→recepción→resto de ruta, con/sin
  bodega,3.0min;0 fallos. Conservan roles, aislamiento, replays y recepción.
- Android lint: 0 errores/35 avisos preexistentes. App y APK de instrumentación
  compiladas. StopContinuationUiTest contiene 8 casos, 2 nuevos; no se afirma
  ejecución física de esos tests.
- Métricas de complejidad JaCoCo por método: máximo 10 en política de confirmación
  existente; máximo 8 en funciones de recibo nuevas y 2 en cola de efectos.
- Defectos pendientes en las verificaciones ejecutadas: 0. Consulta HTTP de
  liquidación: 37 muestras, p95=100.5ms y máximo 104.8ms, último recorrido local.
  No es prueba de carga, latencia Android ni SLO productivo certificado.

Se mantiene la excepción física aprobada por el propietario el2026-09-30,
documentada en QA-MULTIPLES-BORRADORES-0.8.19.md. No hay teléfono disponible en
ADB; sólo emulator-5554 offline. No se inicia simulador de navegación ni se
modifica ese emulador. La prueba real del chofer queda a cargo del propietario.

## Contrato conservado y revisión de seguridad

Sólo cambia la sugerencia automática: omite closed_pending y permite elegirlos
manualmente. Los pedidos normales anteriores aún se recuperan según posición.
El menú abre StopAttentionSheet y su Reintentar pedido ya existente. Ninguna
selección confirma llegada/entrega, escribe GPS ni liquida. Un normal pendiente
con ubicación inválida tampoco fabrica un regreso: WarehouseReturnPolicy
permanece idéntica y exige sus condiciones actuales.

El POST de pago y su outbox mantienen payload, commandId, autenticación,
idempotencia, clearing y reintentos. Se conserva únicamente su ID aceptado para
presentación; un refresco fallido no solicita otro POST. El efecto se filtra por
executionId/shipmentId; RouteExecutionModel vuelve a consultar ejecución/plan
coherentes antes de anunciar el cierre completo. Retiro/401/404 limpian efectos;
otra ejecución no recibe el aviso. Una rotación conserva la cola ViewModel;
cerrar consume el aviso y no guía. Reinicio de proceso mantiene NC05: estado
manual consultado al servidor, sin popup durable prometido.

Diff revisado: servidor/src, esquema, dependencias, servicios externos y
credenciales sin cambios. Navegación exige los permisos/disponibilidad previos
y revalida el destino al pulsar. El build conserva las mismas restricciones de
URL/clave y licencias. Firma de APK verificada frente al artefacto0.8.19.

## Reproducción y evidencia

En driver-app, con JAVA_HOME apuntando al JDK21 instalado y ANDROID_HOME al SDK:

```powershell
./gradlew.bat :app:testDebugUnitTest :app:createDebugUnitTestCoverageReport :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
./scripts/verify-arrival-mutations.ps1 -ContinuationOnly
```

El runner de mutación imprime Evidence con su carpeta temporal; comprobar que
results.json tiene34 casos killed=true/failures>0. El wrapper inicial heredó
LASTEXITCODE=1 del último test intencionalmente fallido; la comprobación posterior
independiente de los34 resultados y restauración terminó con exit0. Ese exit1
no se cuenta como fallo de producto ni se oculta como ejecución convencional.

En la raíz, Node24 configurado según el runtime local existente:

```powershell
node node_modules/vitest/vitest.mjs run tests/order-collection-integration.test.ts tests/payments-integration.test.ts tests/driver-service-commands.test.ts tests/settlement-warehouse-integration.test.ts
node node_modules/@playwright/test/cli.js test tests/e2e/settlements.spec.ts
```

HTTP usa el build Next de la fuente de servidor sin cambios. Android compile
valida tipos Kotlin; no se declaran lint/typecheck/build web nuevos en este bloque.
Logs: .local/qa-continuacion-android.log, qa-continuacion-build.log,
qa-continuacion-unit-final.log, qa-continuacion-contracts.log,
qa-continuacion-http.log, qa-continuacion-mutations.log.
Métricas: .local/qa-continuacion-coverage.json y qa-continuacion-mutations.json;
driver-app/app/build/reports/coverage/test/debug/report.xml y lint-results-debug.xml;
driver-app/app/build/test-results/testDebugUnitTest. Gherkin preservado en acceptance-stop-continuation.feature
y ampliado en acceptance-stop-retries.feature; se enlaza a la matriz CN, sin
afirmar ejecución Cucumber independiente.

## APK y comprobación del propietario

.local/releases/ana-rutas-driver-0.8.20-continuacion-reintentos.apk,
versionName 0.8.20/code42, minSdk26/targetSdk36, 69,163,854 bytes.
SHA256: BECA99B27964FC094654F2DE87992988F520B6F35F90E0A6DCC0466D7FF97D8A.
Certificado SHA256: f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35.
APK debug firmado v2 compatible con instalación 0.8.19; conserva datos al actualizar.

1. Entregar/cobrar parada1: aparece2 y botón Ir; Cerrar no guía. Pulsar Ir
   mantiene la guía y los requisitos de llegada previos.
2. Atender3 primero manualmente; después cerrar2: aparece4, no3.
3. Cliente cerrado en1; completar normales restantes: aviso de reintentos,
   Elegir reintento, lista pendiente actual; seleccionar1 y usar Reintentar pedido.
4. Resolver un reintento y volver a elegir los restantes, sin destino automático.
5. Cortar red después de confirmar cobro y recuperar: un aviso tras lectura
   coherente; mismo cobro en historial. Rotar/cerrar: no duplicar aviso/guía.
6. Varios pedidos en una parada: avanzar sólo al completar todos; cobro pendiente
   no fabrica cierre. Al resolver todo, conservar Ir a bodega y liquidación previos.

Puertas aplicables verdes con excepción física vigente. Entrega develop
autorizada; sin deploy ni main. Rollback: revertir este bloque de presentación,
sin migración ni pérdida de recibos/historial.
