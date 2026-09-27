# QA — Ruta en vivo compacta (BL-140 / CC20)

## Alcance y autopsia

El dashboard duplicaba título/explicación sobre la tarjeta expandible. Su cuerpo
tenía límites 60vh/750px incompatibles con el hijo de 68vh. Se unifica el título
con ayuda, actualizar y expandir; flex ocupa el viewport restante. Se retira el
pie global solicitado, no los avisos operativos. GPS, lectura, permisos, polling,
destinos, APK y contratos de negocio no se modifican.

## Reproducción (PowerShell, raíz ana-rutas)

1. `npm run build`
2. `npm run typecheck`
3. `npm run lint`
4. `npx vitest run tests/live-route-presentation.test.ts --coverage --coverage.include=src/core/live-route-presentation.ts`
5. `npx stryker run stryker.live-route-presentation.config.mjs`
6. `npx playwright test tests/e2e/control-center.spec.ts --workers=1`
7. `npx playwright test tests/e2e/panel.spec.ts --workers=1`

Las pruebas usan Next compilado, PostgreSQL aislado y HTTP reales, sin mocks ni
escrituras en datos productivos. Google Maps no está configurado en esta instalación
QA: se comprueba el canvas/contenedor real con fallback del producto, no el SDK
remoto. El mapa real tras Deploy se revisa en develop; no se declara probado aquí.

## Evidencia ejecutada

- Build, TypeScript y ESLint: exit 0.
- 12 unitarias verdes; política presentación: 100% statements (9/9), branches
  (12/12), functions (5/5), lines (6/6). Es cobertura de política existente como
  regresión, no cobertura JSX/CSS. UI nueva validada por geometría e interacción.
- Mutación de la misma política: 42/42 killed, 0 supervivientes/timeouts/no cubiertos.
- Centro de control: 4 E2E verdes, 28.4 s. Incluye autenticación (401), origen
  ajeno (403), aislamiento de chofer y versión/contratos; escritura/lectura HTTP
  local observada 475 ms (una muestra, no SLO productivo).
- Regresión general del panel: 1 E2E verde, 45.7 s incluyendo preparación;
  setup, dos sesiones, borrador compartido, CSRF, cuentas, revocación y reinicio.
- Una primera ejecución detectó canvas móvil de altura cero por precedencia de
  `.app` global. Corrección: scope `.app.live-routes-app`; repetición completa
  verde. Ayuda móvil también medida dentro del ancho del viewport.
- Sin nuevos bucles, consultas, dependencias, secretos ni eventos; una prop
  opcional de composición conserva el encabezado original del centro.
- Cero errores de navegador en el recorrido nuevo. Filtro conservado tras
  actualizar/fullscreen; foco recuperado al cerrar avance y reducir pantalla.

| Ventana | Inicio canvas | Alto canvas | Fin tarjeta | Scroll cuerpo |
| --- | ---: | ---: | ---: | ---: |
| 1500×800 | 142.5 px | 629.5 px | 792 px | 0 |
| 1366×768 | 142.5 px | 597.5 px | 760 px | 0 |
| 1024×600 | 142.5 px | 429.5 px | 592 px | 0 |
| 768×844 | 142.5 px | 673.5 px | 836 px | 0 |

En 390/375×844 con menú cerrado el canvas supera 600px, sin overflow horizontal.
Cuatro mapas: canvas 233px en 1500×800 y 217px en 1366×768, todas las tarjetas
dentro de ventana. Resumen separado del canvas por fila de 19px, sin competir
con atribuciones Google. Capturas inspeccionadas: `.local/qa/control-center/standalone-compact.png`
y `standalone-mobile.png`; regresión `map-first-four.png`.

## QA visual después del despliegue

Abrir Ruta en vivo en develop, seleccionar chofer, comprobar ubicación auténtica,
centrar/seguir, Ver avance, actualizar, ayuda y fullscreen. Repetir cuatro
tarjetas y móvil. La clave/SDK y telemetría productiva no se simulan. No requiere
APK nueva; desplegar el commit web. Reversión mediante revert del commit de este
bloque, sin migración ni cambio de datos.
