# QA — cálculo previo de ruta manual y navegación 0.5.2

25/09/2026. `develop`, base `2db87e2`. Commit y push exclusivamente a
`develop` autorizados por el usuario después de las puertas locales; sin
Deploy ni cambios en `main`. Instalación de APK y validación física a cargo
del usuario; no se utilizó ADB.

## Autopsia y alcance

- El mapa del borrador sólo dibujaba polilíneas cuando existía una optimización
  vigente; el primer cálculo manual se encolaba al confirmar publicación. Ahora
  abrir el mapa de un plan completo consulta el estado durable y solicita **una**
  medición para la versión sin recorrido. Reabrir reutiliza recorrido o trabajo
  pendiente. Un fallo requiere reintento explícito. Publicación y cálculo siguen
  separados; nunca se reordena ni se invoca Fleet Routing.
- GPS y red podían entregar muestras de precisión distinta y fuera de orden. La
  interfaz volvía a la lectura imprecisa tras sólo 3 s, aunque la última muestra
  válida todavía cumpliera la edad autorizada por el servidor. Se descartan
  callbacks anteriores, se reutiliza sólo esa muestra vigente durante jitter
  impreciso y se revoca ante una lectura confiable fuera de radio. La misma muestra
  seleccionada se usa para estado y comando. No aumentan radio ni precisión;
  simulación, caducidad, cambio de punto o falta de ubicación bloquean.
- El mute se reaplica al iniciar o reanudar guía, además de guardarse al tocar
  el botón. Se usan las dos APIs oficiales de audio del Navigator en el hilo UI.
  Se deshabilitan mediante APIs oficiales la tarjeta ETA inferior y el botón
  «Denunciar» de Google para evitar duplicidad con Ana Rutas. La atribución de
  Google Maps sigue visible por obligación de licencia.

## Evidencia local

| Puerta | Resultado |
| --- | --- |
| Servidor con PostgreSQL real | 50 archivos; 547 pruebas pasaron, 1 contrato FCM externo omitido de 548. Cobertura global: 95.16 % líneas, 88.24 % ramas, 96.94 % funciones, 93.75 % sentencias. |
| Lógica de vista previa | 3 pruebas puras; 11/11 líneas y 22/22 ramas cubiertas; 62/62 mutaciones detectadas (100 %). |
| Recalculo/publicación | Integración PostgreSQL real existente: petición repetida no sube revisión, trabajo vigente se reutiliza y publicar conserva el orden. |
| Android | 47 pruebas JVM, 0 fallos; política GPS 27/27 líneas y 79/82 ramas; 28/28 mutaciones dirigidas detectadas. |
| E2E local | Panel 1/1; móvil 2/2 en repetición aislada. El primer intento combinado agotó el `beforeAll` de 45 s bajo carga concurrente, sin fallo de aserción funcional. |
| Eventos locales observados | Inicio del chofer visible en panel 210 ms; incidencia 500 ms; son mediciones locales, no SLO de producción. |
| Android build/lint | APK debug 0.5.2/code13, APK de prueba instrumentada y lint verdes. Firma SHA-256 del certificado igual a 0.5.1: `f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`. |
| APK final | `.local/releases/Five-Rutas-Chofer-0.5.2-develop.apk`, SHA-256 `e07cdb1a058b48dc619667f66a1e37e5f019c36aef39aaee6e2b9d113484faae`. |
| Seguridad de dependencias Node runtime | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades reportadas. |

Cobertura objetivo por riesgo: política GPS 100 % líneas y al menos 90 % ramas,
mutación crítica al menos 90 %. Cumple localmente; interfaz nativa/Google no se
certifica con JVM y requiere teléfono. La decisión de vista previa es O(pedidos);
el estado se consulta en el sondeo existente cada 2 s y el cálculo vial ocurre
en el trabajador durable, no en cada apertura. No hay medida de latencia real
de Google Routes en este bloque; no se presenta como SLA verificado.

Reproducción: `npm run test:coverage`, `npm run typecheck`, `npm run lint`,
`npm run build`, `npm run test:mutation:manual-route-preview`,
`npx playwright test tests/e2e/driver-mobile.spec.ts tests/e2e/panel.spec.ts`;
en `driver-app`, `./gradlew.bat testDebugUnitTest assembleDebug lintDebug
createDebugUnitTestCoverageReport` y `./scripts/verify-arrival-mutations.ps1`
con configuración local de develop. El primer E2E móvil concurrente agotó el
setup de PostgreSQL; aislado pasó 2/2 sin cambiar código ni timeout.

Pendiente tras Deploy/instalación manual: abrir el mismo mapa dos veces y comprobar
que el segundo acceso no genera otra corrida Google; alterar un pedido y comprobar
una nueva versión sin cambiar el orden; probar en teléfono GPS/red oscilante,
salida del radio, repunte, mute antes/durante/reanudación de guía y que la tarjeta
ETA desaparezca sin ocultar la atribución. No usar ubicaciones simuladas para
certificar llegada. Ningún dato de clientes se envía en el ajuste de voz.
