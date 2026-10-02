# QA — inicio validado por camioneta 0.8.21

2026-10-02, BL191/IV01..08. Bloque confirmado expresamente por el propietario.

## Contrato comprobado

El inicio real se rechaza mientras cualquier pedido actual de la camioneta
autorizada no tenga fulfillmentStatus=validated. Sólo usa el estado recibido
por la sincronización existente: no solicita Odoo ni reduce su cadencia.
Publicar/armar pendientes sigue permitido. No cambia fotos, fecha, asignación,
revisión, cancelación, contenido publicado, cobros, liquidación, reintentos,
regreso a bodega ni cierre. Ninguna migración/configuración/dependencia nueva.

Inicio y worker se serializan por el lock existente del plan. El rechazo 409
incluye sólo IDs/folios de la camioneta autorizada y no crea ejecución ni
auditoría de salida. Datos atrasados/cliente anterior no evitan la guarda API.
Reintento confirmado sigue antes del nuevo control y conserva la única salida.
Android sin contrato de validación no inventa una lista vacía; el servidor debe
actualizarse con develop antes de utilizar la APK nueva para iniciar.

## Evidencia verde

- 11 pruebas servidor en5 archivos: unidad, PostgreSQL real, publicación,
  comparación de contenido y worker.0 fallos/errores;41.13s en corrida final.
  Incluyen pendientes propios/ajenos/sin asignar/otro plan, validación parcial y
  final, nulo/desconocido, serialización, dos inicios concurrentes, preservación
  del snapshot, fotos, revisión, asignación y retorno idempotente.
- Selector/lectura nuevos:100% líneas, sentencias y funciones. Inicio:100%
  líneas,92.5% sentencias y85.71% ramas; las dos salidas de la guarda nueva están
  verificadas. No se confunde cobertura global con validación de rutas críticas.
- 10/10 mutantes servidor detectados por fallos de assertions: bypass, primer
  pedido, alcance, estado, folios, plan/camioneta, lista vacía, nulo y evento.
  Baseline3/3 en copia aislada; no se modifica el árbol de trabajo durante tests.
- 162 pruebas JVM,0 fallos/errores. canStartRoute:3/3 líneas y16/16 ramas;
  routeValidationMessage:5/5 líneas y6/6 ramas.100% en funciones afectadas.
  Complejidad JaCoCo9 y4 respectivamente; conserva requisitos existentes.
- 6/6 mutaciones Android detectadas por assertions (1–2 fallos por mutante),
  baseline completo verde en copia aislada. Hash del archivo restaurado igual
  al árbol de trabajo.0 supervivientes/errores de infraestructura.
- HTTP/Chrome/PG real:1/1 recorrido completo aprobado. Publicación pendiente,
  rechazo con/sin fotos, ausencia de autorización, revisión incorrecta, cambio
  SSE, inicio y reintento, fotos privadas, incidencias, cancelación, recuperación
  sin SSE y reconexión.47.1s del escenario,1.1min incluyendo preparación.
- Validación recibida visible mediante SSE+GET en228ms;10 GET de ruta con
  p95/máximo28.9ms en local. No mide latencia Odoo, carga ni Android ni establece
  un SLO productivo nuevo; frecuencia y backoff se mantienen intactos.
- Typecheck y ESLint del alcance aprobados; Next producción compilado,15.5s de
  compilación y8.1s TypeScript. Android app/instrumentación compiladas; lint0
  errores/35 avisos preexistentes. Sin cambios a permisos ni secretos.

Las primeras verificaciones corrigieron tres defectos del propio procedimiento:
registrar la camioneta en el plan de aislamiento antes de asignar (FK real),
limpiar la caché pg_stat_activity dentro de la transacción para observar locks,
y esperar reset, que es el evento inicial real del canal móvil. Corridas finales
verdes; no se cambió infraestructura/sincronización para acomodar las pruebas.

## Reproducción

Con Node24 instalado en PATH, desde la raíz:

```powershell
node node_modules/vitest/vitest.mjs run tests/route-start-validation.test.ts tests/route-start-validation-integration.test.ts tests/route-publications.test.ts tests/draft-source-sync.test.ts tests/route-publication-content.test.ts --coverage --coverage.include=src/core/route-start-validation.ts --coverage.include=src/core/route-start.ts
node scripts/verify-route-validation-mutations.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/core/route-start-validation.ts src/core/route-start.ts src/core/driver-mobile-route.ts src/core/driver-financial-store.ts tests/route-start-validation.test.ts tests/route-start-validation-integration.test.ts tests/e2e/driver-mobile.spec.ts scripts/verify-route-validation-mutations.mjs
node node_modules/next/dist/bin/next build
node node_modules/@playwright/test/cli.js test tests/e2e/driver-mobile.spec.ts --grep 'admin provisioning' --reporter=list
```

Desde driver-app, con JAVA_HOME JDK21 y ANDROID_HOME SDK configurados:

```powershell
./gradlew.bat :app:testDebugUnitTest :app:createDebugUnitTestCoverageReport :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
./scripts/verify-arrival-mutations.ps1 -RouteValidationOnly
```

Evidencia local: .local/qa-inicio-validado-{regresion,http,build,android}.log,
.local/qa-inicio-validado-regresion.json, .local/qa-inicio-validado-coverage,
reports/mutation/route-validation.json y carpeta Evidence del runner Android.
En esta ejecución: ana-rutas-arrival-mutations-26e99744ef18472d815b2be131b599aa
en el directorio temporal del usuario; results.json conserva6 detecciones.
Los mutantes deben tener killed=true y failures/assertionFailures>0; un fallo
de infraestructura/compilación no cuenta como detección válida.

## Artefacto y límites

APK: .local/releases/ana-rutas-driver-0.8.21-inicio-validado.apk,69,163,854 bytes.
Versión0.8.21/code43, min26/target36. Firma v2 comprobada y certificado compatible
con0.8.20: f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35.
SHA256: B3C2153F10AE02A77493CAFD447E5EDD5EF463E1B453ECF8F46CF9733379EEE7.

RouteDepartureContractTest añade un caso con el parser Android real: ausencia,
lista pendiente y lista vacía. Está compilado; no se afirma ejecución en teléfono.
Se mantiene la excepción informada de QA física aprobada el2026-09-30: prueba del
chofer a cargo del propietario. No se instaló ni alteró su teléfono o navegación.
La entrega a develop está autorizada; despliegue manual del propietario, sin main.
