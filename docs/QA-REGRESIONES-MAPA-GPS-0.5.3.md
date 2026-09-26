# QA — GPS y mapa de asignaciones 0.5.3

25/09/2026. Base `develop` 6ca3a61. Alcance: reloj de llegada/repunte y
selección de pedidos/trazos del mapa administrativo. Deploy e instalación quedan
a cargo del usuario; no se utilizó ADB.

## Causa raíz

- `RouteNavigationActivity.Chrome` usaba un pulso monotónico de 1 s como si fuera
  el instante actual al evaluar muestras recibidas entre pulsos. Una muestra más
  nueva producía edad negativa, estado STALE y botón intermitente. La evaluación
  ahora lee `SystemClock.elapsedRealtime()` al recomponer; el pulso sólo sirve
  para caducar muestras si dejan de llegar. Llegada, confirmar pin y domicilio
  usan la misma muestra. El servidor sigue validando cada comando.
- El filtro `all` de `RouteMapDialog` incluía `vehicle_id = null`. Los marcadores,
  lista y contador heredaban esa selección, y el mensaje de cálculo vigente podía
  mostrar 0 km con cero asignaciones. El selector único excluye esos pedidos de
  camionetas y los conserva bajo `Sin asignar`. Sólo usa trazos del plan/versión
  actual con exactamente las paradas y secuencia de la asignación consultada.

## Puertas y evidencia

| Puerta | Resultado |
| --- | --- |
| Android JVM | 50 pruebas, 0 fallos. Política GPS 32/32 líneas, 81/84 ramas; evaluación nueva 4/4 líneas, 2/2 ramas. |
| Mutación Android | 32/32 mutaciones dirigidas detectadas; evidencia en directorio temporal de `verify-arrival-mutations.ps1`. |
| Android build/lint | `testDebugUnitTest assembleDebug lintDebug createDebugUnitTestCoverageReport assembleDebugAndroidTest` verde. APK 0.5.3/code14, certificado anterior SHA-256 `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`. |
| Panel unitario | 5 regresiones de selección; asignar, quitar, mover, vista explícita y cálculo de versión/secuencia distinta. |
| Panel E2E | 1/1 con navegador y PostgreSQL real; PATCH de quitar/asignar mientras mapa abierto, conservación del pedido, refresco dentro de presupuesto local de 5 s. Se ejecuta sin Google configurado; los marcadores reales requieren QA del usuario en develop. |
| Panel cobertura | 51 archivos; 553 pruebas pasaron, 1 contrato FCM externo omitido de 554. Global 95.17 % líneas, 88.3 % ramas, 96.96 % funciones, 93.77 % sentencias. Selector: 11/11 líneas, 14/14 ramas, 6/6 funciones. |
| Mutación selector | 57/59 detectadas (96.61 %). Dos supervivientes semánticamente equivalentes: omitir una comparación con `null` que `Set.has(null)` ya rechaza, o insertar una ruta sin `vehicleId` que el filtro descarta. No alteran pedidos, rutas ni métricas. |
| Panel typecheck/build/lint | `npm run typecheck`, `npm run build` y `npm run lint` verdes. |
| Dependencias runtime | `npm audit --omit=dev`: 0 vulnerabilidades reportadas. |
| APK | `.local/releases/Five-Rutas-Chofer-0.5.3-develop.apk`, SHA-256 `06fbdedec1ce16959af20a57fa6eeda9d5c42b10b6b2bfcb3e3dafe6291fb054`. |

Cobertura objetivo por riesgo: 100 % líneas de evaluación GPS y selector del mapa,
al menos 90 % ramas de ambos; mutación crítica sin supervivientes. La prueba
de GPS físico/navegación real depende del teléfono del usuario. El refresco de
mapa usa el sondeo existente cada 2 s; 5 s es presupuesto local de aceptación,
no una medición de latencia en producción. El cambio no añade solicitudes Google.

Reproducir: `npm run test:coverage`, `npm run typecheck`, `npm run lint`,
`npm run build`, `npx stryker run stryker.route-map-selection.config.mjs`,
`npx playwright test tests/e2e/panel.spec.ts`; en `driver-app`,
`./gradlew.bat testDebugUnitTest assembleDebug lintDebug createDebugUnitTestCoverageReport assembleDebugAndroidTest`
y `./scripts/verify-arrival-mutations.ps1` con configuración local de develop.
