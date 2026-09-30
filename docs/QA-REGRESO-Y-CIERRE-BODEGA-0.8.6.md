# BL-154/155 · regreso a bodega y cierre operativo · 0.8.6

Fecha: 2026-09-29. Rama `develop`, base `933b507`. La validación se realizó localmente, sin deploy, cambios remotos, escrituras Odoo ni alteraciones del repositorio five. El propietario autorizó expresamente commit y push a `develop` para probar, después de informar que el QA físico sigue pendiente. Esta autorización no certifica producción ni autoriza cambios en `main`; deploy manual del propietario. La prueba física pendiente no se declara aprobada.

## Alcance e invariantes

- El punto de salida global real se superpone en la lectura móvil autorizada sin cambiar snapshots, hashes ni revisiones publicadas.
- Sólo la correspondencia completa de pedidos `delivered`/`rescheduled` permite regresar y terminar. Un reprogramado no se convierte en entregado. `open`/`closed_pending`/`rejected`, pedidos faltantes/extra/duplicados, origen inválido y publicación distinta bloquean el regreso.
- Bodega es destino auxiliar, nunca una parada ficticia: tracking transmite destino nulo. Guía SDK sólo por pulsación explícita, con protección contra callbacks viejos, origen actualizado, reapertura y revocación.
- Terminar exige GPS real, reciente y preciso en el radio configurado, Aceptar en el modal y confirmación del servidor. Cancelar no envía nada. No se cambia el radio ni se amplía con el error de GPS.
- Migración aditiva 32: finalización operativa inmutable por ejecución, con actor, dispositivo, comando, hora, origen/política versionados, GPS y pedidos. No hay backfill que cierre rutas anteriores.
- Un mismo comando recupera su recibo aun con GPS ya envejecido. Otro comando no vuelve a finalizar. Bloqueos de publicación/ejecución serializan finalización y reapertura; error de auditoría revierte todo.
- Terminar detiene guía/tracking y nuevas operaciones móviles; conserva consultas, recibos, pedidos, incidencias, auditoría y métricas. No liquida, libera vehículos, fija fechas ni borra reprogramados. Administración conserva sus herramientas existentes.
- Reprogramar a distancia sólo un reintento `closed_pending` con incidencia real de cliente cerrado, identidad de visita y versiones vigentes. Entregar/rechazar/reportar mantiene visita activa y llegada. No se elimina ninguna validación GPS de entrega.
- UI conserva colores, vectores y estilo existentes, según `ui-ux-pro-max`; incluye los tintes solicitados de BL-153.

## Evidencia técnica

| Puerta | Resultado |
| --- | --- |
| Dirigida PG/contrato/políticas/presentación | 53/53, 7 archivos, 293.71 s; PostgreSQL aislado real, sin dobles de API |
| Cobertura V8 dirigida | Líneas 100%, funciones 100%, ramas 98.94%, sentencias 99.02%; cierre y política 100% en las cuatro métricas |
| Regla Android bodega | 17/17 líneas, 70/70 ramas, 250/250 instrucciones |
| Política Android atención/reprogramación | 17/17 líneas, 44/44 ramas, 188/188 instrucciones |
| JVM Android | 110/110, sin fallos/errores/omitidas |
| Mutación regla servidor | 32/32 detectadas, sin sobrevivientes/timeouts/errores; Stryker |
| Mutación integración servidor | Baseline 4/4 y 10/10 detectadas: GPS, pendientes, versiones, bloqueo posterior, tracking, revisión, excepción remota y caso cerrado real |
| Mutación bodega Android | 13/13 detectadas en copia temporal aislada |
| HTTP/E2E real | 2/2, 1.3 min; login/permisos, foto privada, aislamiento, llegada, reprogramación fuera de visita, cierre, recibo, consultas/revocación y recuperación SSE |
| Typecheck/lint/build Next | Aprobados; lint 0 errores y 1 advertencia preexistente de otro config Stryker |
| Build/lint APK + APK de instrumentación | Aprobados; lint Android 0 errores/33 advertencias preexistentes |
| Dependencias runtime | `npm audit --omit=dev`: 0 vulnerabilidades; sin nuevas dependencias ni cambios de lockfile |
| Artefactos cliente | 14 archivos revisados contra secretos del preview local: sin exposición |
| Instrumentación/QA físico | Pendiente: ADB rechaza `am get-config` con `closed`; ninguna de las 11 pruebas instrumentadas se cuenta como ejecutada |
| Regresión general | Primera ejecución: 669 aprobadas, 3 fallos en preparación de fixtures antiguos, 2 omitidas, 70 archivos, 1000.11 s. Corregido sólo el helper aislado; repetición completa de sus dos archivos: 16/16 aprobadas, 19.25 s. Resultado por escenarios: 672 aprobadas y 2 omitidas; no se presenta como una suite verde en un único intento |

Cobertura: `.local/qa/warehouse-return/backend-coverage/coverage-summary.json` y `driver-app/app/build/reports/coverage/test/debug/report.xml`. Mutación: `reports/mutation/route-completion.json`, `reports/mutation/route-completion-integration.json`; Android: `%TEMP%/ana-rutas-arrival-mutations-1b8496d0fe414bfa961d4550d1b167b6/results.json`. APK/tests/lint se recompilaron después del último cambio Android.

Regresión de migraciones: el helper que reconstruye v1/v2/v3 eliminaba ejecución con `CASCADE`, lo que retiraba su clave foránea pero dejaba la tabla v32 de finalización y sus referencias a dispositivos/choferes. PostgreSQL rechazaba después retirar los dispositivos; el tercer fallo era consecuencia de la preparación incompleta anterior. Se incluyó explícitamente esa tabla vacía en el `DROP` del fixture, exclusivamente en los clústeres temporales de pruebas. No se cambió la migración productiva, se debilitó una clave ni se borró historial real. Todos los consumidores de esa función están en `tests/orders.test.ts` y `tests/fleet.test.ts`, repetidos íntegramente con `npx vitest run tests/orders.test.ts tests/fleet.test.ts`. Las dos omisiones de la suite general son lecturas Odoo condicionadas a configuración externa y FCM real; no son pruebas ejecutadas ni fallos ocultados.

Objetivo de riesgo: 100% líneas/ramas de la política de cierre y finalización; resto dirigido cumple umbrales del repo (líneas85/funciones90/ramas80/sentencias85). El 1.06% de ramas restante pertenece a lectura móvil existente, no al cierre. No es cobertura global ni sustituto de QA físico. Primer intento de cobertura sólo sobre lectura móvil no cumplía funciones/ramas: se amplió el conjunto real de contratos/contactos/correcciones y se repitió sin bajar umbrales. Mutación detectó tres huecos iniciales; se reforzó validación de código de error y exceso de IDs y se eliminó una condición matemáticamente redundante, conservando el rechazo de duplicados. Repetición final 100%.

## Métricas

`reports/route-completion/latency.json`: primer cierre 25.17 ms; 30 recuperaciones de recibo p50 9.27 ms, p95 10.89 ms, máximo 12.51 ms; 0 errores, 1 cierre durable, 0 cierres duplicados. PostgreSQL local aislado: **no es un SLO móvil, de red ni de producción**. HTTP/SSE de regresión final: publicación158 ms, inicio249 ms, incidencia383 ms, reconexión199 ms. No se extrapola latencia de Google/GPS.

`reports/complexity.json`: estimación AST de funciones nombradas: entrada cierre2, regla de pedidos5, migración1. El wrapper transaccional figura1 porque el medidor existente excluye callbacks anónimos; no representa la complejidad total del comando. Defectos finales dirigidos:0. Compilación/seguridad no certifican ausencia absoluta de defectos.

## Reproducción

Desde la raíz ana-rutas, con dependencias existentes:

```powershell
npx vitest run tests/driver-route-completion-policy.test.ts tests/driver-route-completion.test.ts tests/driver-mobile.test.ts tests/driver-execution.test.ts tests/driver-service-commands.test.ts tests/live-route-presentation.test.ts tests/live-eta.test.ts --coverage --coverage.include=src/core/driver-route-completion.ts --coverage.include=src/core/driver-route-completion-policy.ts --coverage.include=src/core/driver-mobile-route.ts --coverage.include=src/core/live-route-presentation.ts --coverage.include=src/core/live-eta.ts --coverage.reportsDirectory=.local/qa/warehouse-return/backend-coverage
npx stryker run stryker.route-completion.config.mjs
node scripts/verify-route-completion-mutations.mjs
npx tsx scripts/qa-route-completion-metrics.ts
npm test
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/driver-mobile.spec.ts
npm audit --omit=dev
```

Con ANDROID_HOME/JAVA_HOME configurados a los runtimes locales existentes, desde driver-app:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest createDebugUnitTestCoverageReport --console=plain
.\scripts\verify-arrival-mutations.ps1 -WarehouseOnly
.\gradlew.bat connectedDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=com.five.anarutas.driver.StopContinuationUiTest,com.five.anarutas.driver.RouteDepartureContractTest,com.five.anarutas.driver.WarehouseFinishUiTest' --console=plain
```

Aceptación: `tests/acceptance-warehouse-return.feature`. Bases, triggers de fallo/barreras y mutantes son exclusivamente fixtures/copia temporal, no instalaciones reales. La instrumentación usa parser/Compose reales; no Navigator, API ni proveedor GPS simulados.

## QA físico pendiente y orden de prueba

El propietario despliega manualmente el backend develop actualizado (migración32 automática y aditiva) antes de probar la nueva función en APK. Servidor anterior sin `departure` no inventa bodega; sin endpoint finish no confirma cierre. Sin esta validación no autorizar producción.

1. Ruta iniciada real, con bodega configurada: dejar un pedido abierto y un reintento; no debe ofrecer retorno/cierre.
2. Registrar cliente cerrado con foto, salir de visita y alejarse: abrir Pedido/Reprogramar, confirmar nota; verificar reprogramado, no entregado, en administración. Intentar entregar desde lejos: exige nueva llegada.
3. Entregar/reprogramar restantes: aviso Ir a bodega; cerrar aviso y reabrir mapa conserva botón. Pulsarlo guía Google a las coordenadas reales y seguimiento no inventa parada.
4. Cambiar origen/reabrir un reprogramado mientras calcula: la guía anterior no debe arrancar ni continuar. Recuperar mediante acción explícita.
5. En bodega con GPS reciente preciso aparece Terminar ruta. Abrir modal, Cancelar: no cambia nada. Alejarse o perder precisión con modal abierto: Aceptar bloqueado.
6. Aceptar; perder respuesta/red y reiniciar app: Verificar confirmación recupera un solo cierre. Desaparecen guía/notificación/tracking, Ruta terminada en app/control. Pedidos y reprogramaciones quedan intactos; no liquidación.
7. Intentar reabrir, entregar, corregir, reportar o iniciar tracking tras cierre: servidor rechaza. Consultas y herramientas administrativas siguen disponibles.
8. Probar rotación, fondo/regreso, permiso GPS retirado, origen ausente, revocación y dispositivo distinto sin duplicación ni filtración de datos.

## Artefacto

APK de prueba `.local/releases/Five-Rutas-Chofer-0.8.6-develop.apk`, package `com.five.anarutas.driver`, versionCode28. SHA256 `85F30B1FFE7710CCB8133CB032CDB4D672AA782115EA7C1D6AB25E4D6C928D6D`. Firma de desarrollo compatible con la APK anterior; verificada al copiar. No certificado de producción ni publicación automática.
