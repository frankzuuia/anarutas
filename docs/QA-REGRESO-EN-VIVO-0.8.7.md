# BL-156 — regreso a bodega en Ruta en vivo

2026-09-29. Desarrollo sobre `develop`, base `7eaf556`. El propietario autorizó expresamente commit y push de este bloque a `develop` para probar, después de informar el QA físico pendiente y las dos omisiones externas existentes. No autoriza cambios en `main` ni despliegue. Estado: implementación, verificaciones dirigidas y regresión general aprobadas; GPS/SDK físico pendiente. No certificación de producción.

## Causa y alcance

La guía a bodega es un destino auxiliar: correctamente no tiene `stopId` de cliente. El servicio móvil y el panel sólo conocían ese ID, de modo que la guía real se presentaba como «Sin destino confirmado» y no compartía su ETA. No se corrige deduciendo regreso a partir del contador de entregas.

Ahora la APK comparte `destination={kind:warehouse,depotVersion}` sólo para una guía vigente o un cálculo vigente del SDK hacia el origen autorizado. ETA conserva segundos reales del SDK, `targetStopId=null` y versión coincidente. Una selección antigua, SDK liberado, guía detenida, origen retirado o pedido reabierto no mantiene una señal confirmada. Un rechazo específico de metadatos de bodega retira ese metadato sin interrumpir GPS; sesión/cierre/revocación conservan sus rechazos anteriores. El destino enviado y su ETA se toman de un mismo corte inmutable en el hilo principal.

Servidor: migración automática/aditiva33, columna nullable en la última muestra de tracking, sin backfill. Valida permisos/sesión/secuencia, origen y correspondencia exacta de pedidos terminales bajo los locks existentes. La lectura vuelve a validar origen/pedidos en REPEATABLE READ. Audita cambios de destino, no cada heartbeat. Inicio de sesión, guía/seguimiento detenidos y cierre limpian el metadato. No crea una parada de bodega ni modifica pedidos, cantidades, evidencias, publicaciones, reglas de llegada/reintento o liquidaciones. El único cambio al comando de cierre es limpiar también este metadato.

Panel: «De regreso a bodega» en avance/resumen/tiempos; al envejecer la señal, «Regreso a bodega · sin confirmación reciente». ETA exige su propia frescura y GPS reciente. Clientes y atención conservan su comportamiento; diseño, iconos y colores existentes preservados. Terminar tiene prioridad y no deja un regreso activo.

## Evidencia y puertas

| Verificación | Resultado / evidencia local |
| --- | --- |
| Unitarias + PostgreSQL dirigidas | 42/42; `reports/live-warehouse-tests.json` |
| Cobertura de ocho módulos afectados | Líneas/funciones/sentencias100%, ramas99.19% (247/249). Políticas nuevas, entrada/ETA, escritura y cierre100%; las dos ramas sin cubrir son las alternativas de polilínea preexistentes, fuera de este cambio. `reports/coverage-live-warehouse` |
| Mutation testing de políticas/ETA/presentación | 289/289 detectados, 0 supervivientes/timeouts/sin cobertura; `reports/mutation/live-warehouse.json`. Umbral100%, sin exclusiones nuevas |
| Mutantes de integración real | 8/8 detectados, baseline1/1; origen, terminales, secuencia, sesión, persistencia, lectura/revocación y ETA retirada. `reports/mutation/live-warehouse-integration.json` |
| Android JVM | 116/116, 0 errores/fallos; reportes Gradle `app/build/test-results/testDebugUnitTest` |
| Cobertura Android crítica | `TrackingDestinationPolicy.kt`: líneas12/12, ramas36/36 e instrucciones173/173. No confundir con cobertura total de Compose/Service/SDK |
| Mutantes Android | 13/13 detectados en copia aislada, baseline JVM real; evidencia `C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-ec22aaa9e5de439e8e88cb9fa58c977b/results.json` |
| HTTP/E2E y UI | 2/2 aprobadas también en la repetición final tras conservar los textos de clientes de Tiempos. Next real + PostgreSQL aislado + navegador, sin dobles HTTP. Capturas `reports/screenshots/live-warehouse-desktop.png` y `live-warehouse-mobile.png` inspeccionadas |
| Regresión general | 679 aprobadas, 0 fallos, 2 omitidas, 72 archivos, una ejecución verde. `reports/live-warehouse-regression.json`; omisiones existentes: lectura Odoo real de thumbnails y envío OAuth/FCM real, condicionadas a configuración externa. No se ejecutaron ni sustituyeron por mocks |
| Typecheck/build/lint | Next compilado, typecheck aprobado, lint sin errores ni advertencias nuevas (1 advertencia global anterior). Gradle assembleDebug/assembleDebugAndroidTest/lint aprobados, 0 errores/33 advertencias existentes |
| Seguridad | Autorización/aislamiento/revocación/cancelación/secuencia/versiones/entrada/CHECK probados; npm audit runtime0 vulnerabilidades. Escaneo de 14 artefactos cliente: sin secretos locales expuestos. SQL parametrizado, misma superficie autenticada y sin dependencia nueva |
| GPS/Google/Compose físicos | NO ejecutados ni aprobados: `adb devices` enumera emulator-5554, pero `adb shell am get-config` devuelve `error: closed`. No reset, borrado, proveedor GPS ni Navigator simulado |

Los datos de ejecución/publicación conservados se comparan antes/después de tracking. Un reprogramado se reabre mediante el comando real: inmediatamente desaparece la proyección de regreso; para volver a reprogramar se registra de nuevo el cliente cerrado con evidencia y visita real. Las migraciones reconstruyen v32 exclusivamente en una base temporal propia y se ejecutan concurrentemente sin alterar las coordenadas/sesiones anteriores. La matriz Gherkin está en `tests/acceptance-live-warehouse.feature`; WD01..WD10 en MASTER-SPECIFICATION.

Durante el desarrollo se detectó y corrigió un CHECK que, por la lógica ternaria de SQL, rechazaba un destino de cliente con metadato nulo. Se volvió explícito `warehouse_depot_version IS NULL OR (...)`; las regresiones de cliente/ETA luego pasaron completas. También se corrigieron datos de preparación de nuevas pruebas (secuencia de visita posterior a llegada, reprogramación desde un nuevo caso cerrado y revisión incrementada por cancelación). No se relajaron reglas de negocio para hacerlas pasar. La primera mutación dejó 10 supervivientes: se reforzaron casos límite hasta289/289, sin bajar el umbral. Una repetición de Stryker chocó con eliminación de carpetas temporales de PostgreSQL concurrente y se repitió aislada correctamente; no se contó como resultado válido. Un mutante Kotlin inicialmente no compilaba y fue reformulado manteniendo su error semántico; sólo se contabiliza el ensayo final con13 fallos detectados por pruebas.

## Métricas y límites

`reports/live-warehouse-latency.json`: muestra local real y pequeña, bajo pruebas concurrentes; 9 escrituras de regreso aceptadas, p50=9.52ms, p95/máximo=90.66ms; 15 lecturas, p50=11.70ms, p95/máximo=55.27ms; 0 errores inesperados en ese recorrido. No es un SLO de producción, Google, red ni GPS. No se extrapola el ETA ni se ha medido latencia física móvil. Se conserva el heartbeat y la política de antigüedad ya configurados, sin imponer presupuestos nuevos.

`reports/complexity.json`: estimación AST de funciones nombradas; entrada de destino9, proyección10, estado de regreso9, etiqueta6, migración1; `routeEta`25 por las guardas de estado/edad/identidad, con cobertura y mutación completas. Los callbacks anónimos no quedan representados íntegramente por esta métrica; no se presenta como complejidad total del sistema. Defectos abiertos dirigidos0; no significa garantía de ausencia absoluta de errores.

## Reproducción

Desde la raíz ana-rutas, con runtimes/dependencias locales existentes:

```powershell
npx vitest run tests/live-warehouse.test.ts tests/live-warehouse-integration.test.ts tests/live-eta.test.ts tests/live-eta-integration.test.ts tests/live-tracking.test.ts tests/live-route-presentation.test.ts tests/driver-route-completion-policy.test.ts tests/driver-route-completion.test.ts --coverage --coverage.include=src/core/live-warehouse-policy.ts --coverage.include=src/core/live-warehouse-schema.ts --coverage.include=src/core/live-route-destination.ts --coverage.include=src/core/live-eta.ts --coverage.include=src/core/live-eta-validation.ts --coverage.include=src/core/live-tracking.ts --coverage.include=src/core/live-routes.ts --coverage.include=src/core/driver-route-completion.ts --coverage.reportsDirectory=reports/coverage-live-warehouse --reporter=json --outputFile=reports/live-warehouse-tests.json
npx stryker run stryker.live-warehouse.config.mjs
node scripts/verify-live-warehouse-mutations.mjs
npx vitest run --reporter=json --outputFile=reports/live-warehouse-regression.json
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/driver-mobile.spec.ts
npx tsx scripts/quality-metrics.ts
npm audit --omit=dev
```

Ejecutar Stryker sin otro proceso creando/eliminando carpetas PG dentro del mismo workspace. Sus pruebas son unitarias; el ensayo de integración usa su copia y PostgreSQL reales. Desde driver-app, con ANDROID_HOME/JAVA_HOME existentes:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\scripts\verify-arrival-mutations.ps1 -TrackingDestinationOnly
```

## Artefacto y validación física pendiente

APK de desarrollo `.local/releases/Five-Rutas-Chofer-0.8.7-develop.apk`, package `com.five.anarutas.driver`, versionCode29. SHA256 `3475423B5D4CB1AACD50FE86AA59677A78996E80C70A1ECCD626242D276109FE`. Firma verificada igual a0.8.6: certificado SHA256 `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`. Se conservó la APK anterior, sin sobrescribirla. Firma de desarrollo, no distribución certificada de producción.

Para probar la función completa se requiere **backend actualizado/schema33 primero y APK0.8.7**. La migración es automática al arrancar, no requiere SQL manual. APK anterior sigue enviando destinos de cliente válidos, pero no comunica regreso. Backend anterior no certifica el contrato nuevo; tras upgrade33, rollback requiere una versión de servidor que admita33, no rebajar el marcador de schema manualmente. Deploy sólo manual del propietario y con autorización separada; main intacto.

1. Iniciar ruta real y completar/reprogramar todos los pedidos; antes de pulsar Ir a bodega no debe aparecer un regreso inventado.
2. Pulsar Ir a bodega: comprobar guía Google real y estado en avance/resumen/tiempos. ETA puede mostrar Calculando o No disponible si el SDK no aporta un tiempo válido; no inferirlo de los kilómetros.
3. Pasar al fondo y volver/rotar/cerrar mapa con guía activa: estado consistente. Detener guía/seguimiento: retirar regreso. Liberar SDK sin guía activa: no continuar enviando un destino antiguo.
4. Desconectar red más que la frescura permitida: mensaje sin confirmación reciente y tiempo desactualizado. Reconectar: sólo muestras nuevas, nunca rejuvenecer GPS anterior.
5. Cambiar bodega o reabrir un reprogramado: retirar la señal; GPS continúa cuando sólo se rechaza el metadato obsoleto. Resolver/reprogramar mediante sus controles existentes y volver a iniciar guía explícitamente.
6. Llegar físicamente a bodega, abrir el modal de cierre y Cancelar/Aceptar según la regla existente: aceptar confirma una sola terminación, detiene seguimiento y muestra Ruta terminada. No liquidación ni modificación de cantidades.
7. Revocar acceso/cancelar ruta/cambiar sesión: no filtrar ni mantener un regreso confirmado. Probar también una APK anterior y atención a clientes normales.

Sólo después de validar físicamente estos recorridos puede cerrarse WD-T03B. Sin esa evidencia no declarar listo producción ni dar por iniciadas las liquidaciones.
