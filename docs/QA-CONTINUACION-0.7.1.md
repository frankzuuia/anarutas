# QA — resumen legible y continuación de paradas 0.7.1

BL-138/CC19 y BL-139/NC01..06. Base d0af2cd, develop, 26/09/2026.
Sólo Ana Rutas; sin main, Five, datos desplegados ni Deploy automático.

## Autopsia e integridad

- Captura real confirmó colisión del control BOTTOM_LEFT con atribuciones.
  Se elimina el portal Google y coloca resumen de 19 px en flujo fuera del canvas,
  dentro de la tarjeta. Sin manipular, ocultar ni superponer créditos/logo.
  Franja idéntica con Maps y fallback; filtros, progreso y avance intactos.
- Android renderizaba preview antes de recibir Navigator y no redibujaba al
  recuperar isGuidanceRunning. Tampoco excluía el cálculo pendiente. Ahora consulta
  también el SDK retenido, omite preview al calcular y redibuja al conectar/iniciar.
  Marcadores mantienen su filtro independiente; no hay cálculo de rutas al refrescar.
- ViewModel genera aviso sólo para comando confirmado tras releer ejecución.
  Cliente cerrado sigue exigiendo recibo del servidor; entrega parcial no adelanta.
  Siguiente se busca por posición, con retorno a pendientes anteriores distintos
  del actual; omite terminales/sin punto/sin pedidos atendibles. Se revalida al pulsar.
- Aceptar usa navigateToStop → salida de visita autorizada/versionada/idempotente
  → guía explícita a un destino. Cerrar sólo consume aviso; no cambia pedidos,
  llegada, incidentes ni estado financiero. Sin siguiente no ofrece guía ficticia.
- Rotación conserva aviso en ViewModel y foto sin enviar en rememberSaveable.
  Desmontar el formulario por incidente confirmado limpia únicamente su copia
  en incident-camera, con comprobación de padre canónico; captura cifrada/recibo
  continúan bajo la cola existente. Reinicio de proceso tras éxito vuelve al
  estado real/manual; no se promete persistencia del aviso efímero ni se reenvía.
- No cambian autenticación, autorización, aislamiento, permisos, claves, endpoints,
  esquema, dependencias, timestamps GPS, reglas de llegada o liquidación.

Referencias: docs locales Next16 use-client/CSS y Navigator oficial:
https://developers.google.com/maps/documentation/navigation/android-sdk/reference/com/google/android/libraries/navigation/Navigator
La revisión de UI se limitó a contraste, densidad y separación; no cambió el
sistema visual existente ni agregó librerías/activos externos.

## Comandos reproducibles

```powershell
npm run build
npm run typecheck
npm run lint
npx vitest run tests/live-route-presentation.test.ts --coverage --coverage.include=src/core/live-route-presentation.ts
npx stryker run stryker.live-route-presentation.config.mjs
npx playwright test tests/e2e/control-center.spec.ts
npx vitest run tests/driver-service-commands.test.ts tests/driver-execution.test.ts tests/driver-execution-concurrency.test.ts
npx playwright test tests/e2e/driver-mobile.spec.ts
npm audit --omit=dev
```

En driver-app, JDK21 y SDK Android local:

```powershell
$env:ANDROID_HOME='C:/Users/figod/AppData/Local/Android/Sdk'
./gradlew.bat :app:testDebugUnitTest :app:createDebugUnitTestCoverageReport :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain
./scripts/verify-arrival-mutations.ps1 -ContinuationOnly
```

## Evidencia

- Panel: build/tipos/lint verdes; 12 unitarias, política 6/6 líneas, 12/12 ramas,
  5/5 funciones (100%). 42/42 mutantes detectados, cero supervivientes/timeouts.
  Regresión de política existente, no se presenta como cobertura de CSS/SDK.
- 3 E2E control-center verdes (22.6 s), servidor Next compilado y PG reales.
  Resumen 19 px, intersección con canvas cero, cuatro tarjetas completas sin scroll.
  1500×800: canvas 215.25 px (68.94% tarjeta), 1366×768: 199.25 px (67.26%).
  Región mapa+resumen 75.02/73.67%. Se reduce canvas exactamente 19 px para
  reservar lectura independiente; umbral explícito canvas >=190 px y >=65%.
  Fullscreen, selector, persistencia, teclado, drawers y 390 px verificados.
- Captura inspeccionada: `.local/qa/control-center/map-first-four.png`.
  E2E sin clave usa fallback real, NO tiles ficticios ni mocks Google. Separación
  estructural no depende del ancho del texto de atribución. Ver Maps tras Deploy.
- Android pase final: 85 JVM verdes; política nueva 12/12 líneas, 26/26 ramas,
  3/3 métodos (100%); complejidad JaCoCo 13 acumulada en tres métodos. Objetivo
  100% por selección y exclusión de navegación. No equivale a cobertura de Activity.
- Selección local O(n log n), sin I/O, sin peticiones adicionales periódicas;
  guía usa únicamente clic explícito. Sin nuevo SLO de red; continúa el existente.
- Contratos PG: 16 pruebas verdes en tres archivos (332.69 s). Incluyen nueva
  regresión salida de visita tras completar dos pedidos, sin reabrirlos, sin
  llegar automáticamente al siguiente, sin cerrar ruta y con replay idempotente;
  además cerrado/foto/recibo, permisos, conflicto y concurrencia existentes.
- Mutation Android: 18/18 detectados por assertions, cero supervivientes ni
  errores de compilación contados como detección. Copia aislada, sin ADB:
  `C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-6c1d77deb94641189aa0bfcd77d7a97c/results.json`.
- Recompilación final APK, tests JVM/cobertura e instrumentación Compose verdes;
  lint Android 0 errores y 33 warnings heredados. npm audit producción: 0
  vulnerabilidades informadas. Sin cambio de dependencias.
- E2E móvil HTTP: primer intento agotó beforeAll a 45 s al ejecutarse junto a
  Gradle y mutaciones; no llegó a un escenario. Repetición: 2/2 verdes en 1.1 min,
  sin elevar timeout ni cambiar código productivo por ese incidente. Cubrió HTTP
  real, permisos, aislamiento, revocación, incidencias y recuperación: incidencia
  visible 284 ms, sin SSE 15,024 ms, reconexión 35 ms. Son mediciones locales,
  no certificación de latencia celular. Cero fallos en el pase final.

## Artefacto de pruebas

`.local/releases/Five-Rutas-Chofer-0.7.1-develop.apk`, 69,321,896 bytes.
Paquete com.five.anarutas.driver, versionName 0.7.1/code20, min26/target36.
SHA256: `2A0F39889A6BAF0723959ED6619AAE43AF2152BA5537012EBCB1A43AFC04EB35`.
Firma verificada con apksigner y comparada con 0.7.0:
`f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`.
Instalable sobre anterior sin borrar datos. Se conserva 0.7.0, no se sobrescribe.
El binario vive fuera de Git; código y documentación sí se publican en develop.

## QA físico pendiente, sin ADB ni simulación

1. Panel tras Deploy manual: cuatro mapas, fechas/atribuciones largas, zoom,
   fullscreen y móvil: resumen abajo separado y créditos íntegros.
2. Instalar 0.7.1 sobre anterior sin borrar datos. Ir a parada 2 con 3/4 pendientes:
   sólo camino al destino y todos los pines pendientes. Salir/reabrir/rotar durante
   guía y cálculo; sin preview general superpuesto. Probar fallo de cálculo/reintento.
3. Llegar con GPS válido y entregar pedido agrupado: primera entrega permanece
   en atención; última muestra aviso. Cerrar/atrás y refrescar no navega/reabre aviso.
4. Aceptar siguiente: visita anterior finalizada, entregas siguen entregadas,
   guía al siguiente, ninguna llegada automática. Al final ofrece anterior pendiente;
   entregadas/reprogramadas/sin ubicación se excluyen. Sin candidato sólo Cerrar.
5. Cliente cerrado con foto: aviso únicamente tras confirmación y folio, punto
   naranja/incidencia conservados; Ir siguiente no resuelve el cerrado. Cortar red,
   verificar recibo y confirmar un único caso. Girar antes de enviar conserva foto.
6. Rotar aviso; cambiar ruta/revocar/sin conexión: no guiar con ejecución inválida.
   Reintento de reprogramado, repunte, teléfono, rechazo y GPS mantienen flujo.

La instrumentación Compose sólo se compila aquí; no se afirma ejecutada en teléfono.
Sigue la excepción de publicación de pruebas develop CC-PUB-AUTH, sin certificación
productiva ni autorización de Deploy. APK debug; seguridad financiera no modificada.
Rollback: revertir UI/Android de este bloque, conservar esquema v24 y auditoría.
