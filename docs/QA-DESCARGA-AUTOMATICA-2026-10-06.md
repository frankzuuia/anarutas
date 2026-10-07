# QA — descarga automática por cliente

Bloque DA01..10. Base `develop` e0f65f7; migración aditiva 45; APK de prueba
0.8.22 / código 44. No se desplegó ni se modificó Odoo o una ruta remota.

## Comportamiento comprobado

El valor manual se conserva como respaldo. Con dos visitas completas se toma
su promedio; desde la tercera, la mediana de las últimas tres. El resultado
se redondea hacia arriba al minuto entero: 22 + 22 → 22; 21, 22 y 30 → 22.
No hay un valor automático fijo de 30 minutos. Una descarga excepcional puede
influir más al comenzar con sólo dos observaciones.

Una visita comienza con la llegada registrada y termina al confirmar el cobro
del último pedido de esa visita. Dos pedidos juntos cuentan una vez. El cierre
se captura en Android con reloj monotónico anclado al servidor y se conserva
en el comando durable; una sincronización tardía no añade tiempo de descarga.
Comandos de la APK anterior, tiempos imposibles, pedidos pendientes o cierres
en visitas distintas no generan una muestra, sin rechazar por ello un cobro
válido. No se reinterpretan visitas históricas.

La evidencia tiene identidad única por pago y visita. La ubicación se aísla por
cliente y versión; mover un cliente inicia aprendizaje del nuevo punto. La
proyección consulta las tres últimas visitas con índice, sin worker periódico,
sin UPDATE del cliente durante el cobro y sin encolar recálculos de Google.
El nuevo armado usa el tiempo efectivo. Las publicaciones nuevas guardan ese
tiempo; el avance de publicaciones anteriores conserva su respaldo manual.

## Resultados y métricas

| Comprobación | Resultado |
| --- | --- |
| Unitarias/contratos/integración del bloque, PostgreSQL real | 10/10 |
| HTTP y panel en Chrome, pruebas nueva y previa de descarga | 2/2; 54.1 s |
| Regresión HTTP/Chrome de relojes, permisos, GPS y cuatro pantallas | 3/3; 56.2 s |
| Google Route Optimization real | 1/1; dos visitas de 22 min → `1320s` enviado y devuelto |
| Regresión general consolidada | 1,117 aprobadas, 0 fallos restantes, 5 opt-in omitidas |
| Android JVM, suite completa | 165/165; 0 fallos, 0 errores |
| Android build, APK y APK de instrumentación | Correctos |
| Android lint | 0 errores; 35 warnings heredados |
| Typecheck, ESLint, build Next, bundle de migración | Correctos; 1 warning ESLint heredado |
| Cobertura V8 del nuevo núcleo | Líneas 14/14, ramas 19/19, funciones 4/4, sentencias 17/17 |
| Cobertura JaCoCo del nuevo reloj Kotlin | Líneas 2/2, ramas 2/2, instrucciones 12/12 |
| Mutaciones dirigidas TypeScript/SQL | 15/15 detectadas |
| Mutaciones dirigidas Kotlin | 4/4 detectadas |
| Complejidad ESLint del nuevo núcleo | Máximo 6; funciones restantes 4, 3 y 1 |
| Lectura de cliente, 60 muestras locales con PostgreSQL | p50 2.56 ms; p95 4.34 ms; máximo 6.59 ms |
| Escenario de Google y 60 lecturas locales | 4,122 ms; una medición, no percentil de Google |
| Auditoría npm productiva | 0 vulnerabilidades |
| Credenciales Google usadas en QA presentes en cambios/navegador | 0; 14 artefactos estáticos revisados |
| Defectos abiertos del bloque en escenarios comprobados | 0; prueba física pendiente |

La corrida completa abarcó 116 archivos: 1,115 aprobadas y dos aserciones
fallidas. Una contaba 27 tablas con notificación y ahora son 28; la otra creaba
snapshots con el formato nuevo pero esperaba el respaldo de publicaciones
anteriores. Se actualizó la cuenta y se hizo explícito el formato pre-v45 en
ese fixture, conservando todas sus aserciones de comportamiento. Se repitieron
los tres archivos afectados: 25 aprobadas y una opt-in omitida. El consolidado
usa el último resultado de cada archivo; no se presenta como una segunda
corrida completa. También pasaron sus tres E2E existentes. No fue necesario
cambiar código productivo para resolver estos dos fallos.

Las cinco omitidas son integraciones opt-in previas de Odoo financiero,
miniaturas Odoo, Google Routes, FCM y prioridad/ruteo Google. No se habilitaron
en la corrida general ni se declaran ejecutadas aquí. La nueva integración
de descarga con Google real sí se ejecutó por separado y pasó.

Objetivo por riesgo: 100% de ramas del núcleo nuevo que admite una observación
y calcula el reloj; conservar cobros, permisos, recibos e idempotencia en
integración. V8 cuenta el SQL como una sentencia y no mide ramas internas de
PostgreSQL: esas invariantes se prueban con transacciones y mutaciones SQL.
Las 19 mutaciones son un conjunto dirigido, no un score exhaustivo global.
Objetivo local de lectura p95 <100 ms cumplido; no es un SLO productivo ni una
prueba de carga. No se establece una garantía de puntualidad de Google.

Las cinco alertas altas de herramientas de desarrollo siguen en la cadena
ESLint/fast-glob/micromatch/braces. No se cambiaron dependencias. Se conserva la
excepción explícita del propietario para subir a develop, documentada en
`QA-TIEMPO-ENTRE-PARADAS-2026-10-05.md`; no autoriza despliegue.

## Matriz de aceptación y seguridad

- DA01/02: una visita agrupada no aprende hasta el último cobro; umbral de dos,
  mediana de tres, orden reciente, redondeo y clientes separados.
- DA03/04: captura antes del envío, replay concurrente, comando reutilizado con
  otra captura rechazado, APK antigua y telemetría inválida sin aprendizaje,
  intervalos no positivos/futuros/fuera del horizonte y visitas discontinuas.
- DA05/06: chofer ajeno no puede cobrar; evidencia inmutable; aislamiento entre
  clientes y ubicaciones; edición sin sesión y versión obsoleta rechazadas.
- DA07: permisos y validación de entradas; modo manual fijo, automático,
  respaldo y estado aprendido visibles; actualización en panel abierto conserva
  una edición todavía no guardada. Chrome sin errores JavaScript ni desborde
  horizontal a 390 px.
- DA08: duración aprendida llega al constructor y a Google real; aprender no
  crea trabajos de recálculo ni modifica publicaciones existentes; snapshot
  publicado y respaldo de versiones anteriores probados.
- DA09/10: instalación nueva y reconstrucción real del esquema 44 en base
  aislada, migración concurrente/repetible, valores manuales conservados.

Gherkin: `docs/acceptance-unloading-learning.feature`, ligado a las pruebas
citadas abajo. No se presenta como ejecución de Cucumber. PostgreSQL, servidor
Next, HTTP, navegador y llamada Google son reales; los datos de prueba se
crean exclusivamente en bases locales efímeras. El contrato Google usa una
visita con pedidos agrupados: comprueba duración, no calidad de reparto zonal.

## Reproducción

1. `npm run typecheck`, `npm run lint`, `npm run build`, `npm run bundle:migration`.
2. `npx vitest run --config vitest.unloading-learning.config.ts --coverage`.
3. `node scripts/verify-unloading-learning-mutations.mjs`.
4. `npx playwright test tests/e2e/customer-unloading.spec.ts tests/e2e/unloading-learning.spec.ts`.
5. `npm test -- --reporter=json --outputFile=reports/unloading-regression.json`.
   Revisión de compatibilidad:
   `npx vitest run tests/live-segment-integration.test.ts tests/panel-events.test.ts tests/unloading-learning.test.ts --reporter=json --outputFile=reports/unloading-regression-recheck.json` y
   `npx playwright test tests/e2e/live-segment.spec.ts`.
6. Google: proporcionar `RUTAS_QA_GOOGLE_CONFIG_FILE` con la ruta privada a un
   JSON de configuración de `readGoogleRoutingConfig`, fuera de Git, y ejecutar
   `npx vitest run tests/unloading-google-live.test.ts`. Sin esta variable la
   prueba se omite explícitamente. Nunca imprimir el archivo ni sus credenciales.
7. Desde `driver-app`, con JAVA_HOME y ANDROID_HOME del equipo:
   `./gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport lintDebug assembleDebug assembleDebugAndroidTest --console=plain`.
8. `powershell -File driver-app/scripts/verify-financial-mutations.ps1 -Scope capture`.
9. `npm audit --omit=dev --json` y `npm audit --json`.

Evidencia local ignorada por Git:
`reports/coverage/unloading-learning/coverage-summary.json`,
`reports/mutation/unloading-learning.json`, `reports/unloading-regression.json`,
`reports/unloading-regression-recheck.json`, `reports/unloading-regression-final.json`,
`reports/unloading-google-live.json`, `reports/unloading-quality.json`,
`reports/unloading-audit.json`,
`reports/screenshots/unloading-learning-{desktop,mobile}.png`;
Android: `app/build/test-results/testDebugUnitTest`,
`app/build/reports/coverage/test/debug/report.xml` y `lint-results-debug.xml`.

## Entrega y comprobación física

APK debug firmada, verificada con apksigner, copiada al escritorio como
`Ana-Rutas-Chofer-v0.8.22-develop.apk`.
SHA-256: `6107cd6bf7fa286c770b5c65646b47d6872e358f96581cc09f36901d0ee8d566`.

El propietario despliega primero backend/panel con esquema 45 y después instala
la APK. La anterior sigue cobrando; no aporta capturas para el aprendizaje.
No había equipo conectado por ADB: no se declara una prueba física terminada.
Para comprobarla, registrar dos visitas completas al mismo cliente con la APK
nueva, observar el valor aprendido, realizar una tercera y comprobar el nuevo
armado. En una visita con dos pedidos, revisar que sólo cuente al cerrar el
segundo; ante una interrupción de red, verificar un solo cobro y la captura
original tras reintentar. Cambiar a Manual fijo debe usar el respaldo guardado.

La captura es telemetría del dispositivo autenticado; no es certificación
antifraude. Un reinicio que invalide el anclaje no aporta muestra. El bloque no
añade métricas comparativas del chofer ni modifica importes de liquidación.
