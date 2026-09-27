# ETA al destino — QA local, 27/09/2026

Alcance: BL-141 / ETA01..08. Trabajo local en develop; no modificación de main,
datos desplegados, Odoo ni claves. La certificación física de Google Navigation
sigue pendiente. No se usaron mocks de Maps, HTTP ni PostgreSQL en las pruebas
de integración añadidas; se ingresaron muestras de contrato en una base local
desechable. Esas muestras NO acreditan que el SDK produzca un ETA real.

## Conexión implementada

Navigator.getCurrentTimeAndDistance → Registry sin referencia a Activity →
servicio foreground → tracking autenticado por ejecución/sesión/revisión →
columna JSONB opcional v25 → lectura privada del panel → representación por chofer.

La app muestra la estimación junto a la parada cuando la barra está contraída,
y en el detalle cuando está expandida. Cada cambio de destino limpia la estimación
anterior. No hay cuenta regresiva extrapolada ni llegada automática por ETA cero.
Todos los choferes abre una lista compacta por ejecución, sin sumar tiempos ni
agregar nombres a los marcadores; elegir una fila afecta sólo a esa pantalla.
GPS o ETA vencidos no se presentan como vigentes. APK anteriores siguen enviando
el contrato anterior y aparecen sin tiempo disponible.

## Evidencia ejecutada

- Unitarios ETA: 5/5. V8: 34/34 sentencias, 55/55 ramas, 2/2 funciones,
  25/25 líneas (100%). Objetivo 100% por riesgo de mostrar un destino/tiempo ajeno.
- Stryker: 141/141 mutantes eliminados, 0 supervivientes, 0 timeouts, 0 sin cobertura.
  La primera corrida reveló dos casos faltantes y una comprobación redundante;
  se corrigieron y se repitió con umbral 100, sin excluir mutantes.
- PostgreSQL/regresiones: 51 casos distintos en 10 archivos. La primera pasada
  tuvo 6 fallos por columna repetida al reconstruir versiones históricas; se
  hizo la migración repetible con ADD COLUMN IF NOT EXISTS. Los archivos afectados
  volvieron a pasar (7 casos en 4 archivos, 6 de recálculo y el caso de reintento).
  Las otras 45 pruebas habían pasado. No se ocultó ni omitió el fallo original.
- Migración v24→25: conserva GPS/sesión, concurrente bajo lock existente,
  repetible con columna presente, rechaza JSON no objeto. Versiones antiguas
  de servidor que rechazan schema25 no son rollback compatible.
- Android: 87 JVM, 0 fallos; assembleDebug, assembleDebugAndroidTest y lintDebug
  completados. Instrumentación compilada, NO ejecutada en teléfono.
  Lint: 0 errores, 33 advertencias existentes; no se declara lint sin advertencias.
- JaCoCo del estado y formateador ETA: 17/17 líneas, 30/30 ramas; 15/15 mutaciones
  manuales de política eliminadas en copia aislada. No demuestra cobertura del
  SDK, listeners ni lifecycle Android, que requieren QA físico.
- ESLint complejidad ciclomática medida: trackingEta=15, routeEta=19; incluye
  las guardas de autenticidad temporal/estado. Se conservan funciones pequeñas
  con 100% ramas y mutación, sin ocultar esa complejidad mediante exclusiones.
- E2E Chrome: 5 recorridos de centro de control (HTTP privado, aislamiento,
  tiempos independientes, estados vencidos/cálculo, teclado, filtros locales,
  fullscreen, cuatro pantallas, móvil 375px). El servidor local NO tiene clave
  de Maps: se verificó el contenedor y el fallback real, no tiles Google simulados.
- Geometría de cuatro pantallas: mapa/contenedor 76.36% a 1500×800, 75.16% a
  1366×768; footer19px, sin scroll interno, sin solapar atribución.
- Secuencia HTTP de tracking/lectura incluida autenticación: 665ms en la primera
  corrida local; es una muestra, NO percentil productivo. Cadencias existentes:
  envío5s y lectura5s, vencimiento30s. No nuevas llamadas de cálculo de rutas.
- Build Next, TypeScript y ESLint completados. npm audit --omit=dev: 0 vulnerabilidades.

Reportes generados: `.local/qa/live-eta/{web-coverage.json,web-mutations.json,
android-coverage.xml,android-mutations.json}`, `.local/qa/control-center/eta-drivers.png`,
`driver-app/app/build/reports/lint-results-debug.html`. Los artefactos locales no
se incluyen en Git. Gherkin: `tests/acceptance-live-eta.feature`.

## Reproducción local

Desde la raíz del repositorio:

```powershell
npm run typecheck
npm run lint
npm run build
npx vitest run tests/live-eta.test.ts --coverage --coverage.include=src/core/live-eta.ts --coverage.include=src/core/live-eta-validation.ts
npx stryker run stryker.live-eta.config.mjs
npx vitest run tests/live-eta-integration.test.ts tests/live-tracking.test.ts tests/driver-incidence-schema.test.ts tests/driver-mobile-phone-migration.test.ts tests/driver-service-commands.test.ts tests/fleet.test.ts tests/google-consumption-persistence.test.ts tests/orders.test.ts tests/recalculation.test.ts tests/route-publications.test.ts
npx playwright test tests/e2e/control-center.spec.ts
npm audit --omit=dev --audit-level=high
```

Desde driver-app con Android SDK/JDK y configuración local existentes:

```powershell
./gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport lintDebug assembleDebug assembleDebugAndroidTest --console=plain
./scripts/verify-arrival-mutations.ps1 -EtaOnly
```

## Artefacto para prueba y puerta pendiente

Excepción autorizada por el usuario el 27/09/2026: «si subelo para que lo pueda
probar», en respuesta a publicar develop como versión de prueba dejando la
validación física pendiente. Autoriza commit/push a develop, no promoción a main
ni certificación productiva. La comprobación del despliegue no se infiere del push.

`.local/releases/Five-Rutas-Chofer-0.7.2-develop.apk`, code21; certificado debug
SHA256 `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`,
igual a la entrega anterior. SHA256 APK:
`3198FFF3C82039A2F1A10EC902C424B9CFEDF994D445CDD02AACDC5DF6A3D5B1`.

Después de publicar backend/panel de prueba autorizado, instalar APK conservando
datos. Con teléfono físico y guía real:

1. Iniciar guía a una parada; comparar la barra y el panel tras un ciclo de envío/lectura.
2. Cambiar destino y provocar recálculo: no debe aparecer el tiempo anterior
   asociado al nuevo destino; esperar Calculando→estimación real.
3. Registrar Llegué: En atención, sin marcar entrega por tiempo cero.
4. Contraer/expandir, rotar, cerrar/reabrir mapa, bloquear/desbloquear teléfono;
   comprobar continuidad foreground y ausencia de listeners duplicados.
5. Quitar GPS/red, esperar30s: Desactualizado. Recuperar: vuelve el dato real
   sin reenviar una cola de tiempos antiguos.
6. Dos choferes y cuatro pantallas: abrir Tiempos por chofer, verificar destinos
   distintos y seleccionar uno sin cambiar las otras pantallas.
7. Detener guía, reprogramar/entregar y cambiar el punto: no queda ETA del destino
   anterior; el pedido no cambia de estado por recibir telemetría.

Hasta ejecutar estos pasos no se declara cerrada ETA-T04 ni lista para producción.
