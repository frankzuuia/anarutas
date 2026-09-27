# QA — Densidad del Centro de control e Incidencias en vivo

Fecha: 26/09/2026. Rama local `develop`. Bloque BL-131..133 / CC13..15.
Cambios sólo en Ana Rutas web y pruebas; no hay APK, migración, Deploy ni
escritura a una instalación externa. Este documento no autoriza commit/push.

## Contratos verificados

- Pie informativo del menú retirado sin eliminar entradas de navegación.
- Ayuda del Centro de control al lado del título; abre por teclado y no ocupa
  una fila cuando está cerrada.
- Incidencias en vivo no tiene filtro de fecha. Conserva el filtro por chofer,
  fecha/hora de cada evento, evidencia privada y acciones autorizadas.
- La consulta viva incluye incidencias de días anteriores mientras la
  publicación de la ruta iniciada siga vigente. Al revocarla deja la vista
  viva, sin borrar la fila ni la auditoría. La pantalla histórica `Incidencias`
  mantiene su selector de fechas.
- En pantalla dividida, el panel de incidencias presenta métricas y fichas
  compactas; `Detalles y acciones` conserva dirección, motivo, nota, foto y
  resolución. A 1500×800 se ven dos casos completos en una pantalla.
- Con cuatro pantallas a 1500×800 y 1366×768, los cuatro marcos 2×2 quedan
  dentro del viewport, sin scroll de página. El contenido largo se desplaza dentro de
  cada marco; una quinta pantalla activa scroll del tablero sin comprimirlos.
  Agregar, mover, expandir y quitar siguen usando el estado real.
  En pantallas estrechas o bajas permanece el desplazamiento normal.

## Procedimiento reproducible y evidencia

Desde la raíz del repositorio, con PostgreSQL local de pruebas configurado:

```powershell
npx vitest run tests/driver-execution-policy.test.ts tests/driver-execution.test.ts tests/driver-service-commands.test.ts --coverage --coverage.include=src/core/driver-incidents.ts --coverage.include=src/core/driver-live-incidents.ts
npx stryker run stryker.live-incidents-scope.config.mjs
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
npx playwright test tests/e2e/control-center.spec.ts tests/e2e/driver-mobile.spec.ts tests/e2e/panel.spec.ts
git diff --check
```

Resultados obtenidos:

- Vitest: **40/40**; PostgreSQL real aislado para publicación, casos de otro
  día, filtro por chofer, revocación, evidencia, resolución con versión
  obsoleta y reintento. Cobertura dirigida: **52/52 líneas (100%)**,
  **56/59 ramas (94.91%)**, **9/9 funciones (100%)** y **63/64 statements
  (98.43%)**. Las ramas restantes son paginación >50, fecha opcional de
  resolución y formato inválido del cursor histórico; no son el nuevo alcance
  vivo ni una autorización nueva. El objetivo del bloque fue 100% líneas y
  >=90% ramas, con las rutas críticas de filtro/publicación bajo mutación.
- Stryker: **23/23 mutantes detectados**, cero supervivientes, reporte local
  `reports/mutation/live-incidents-scope.json`. La cláusula SQL se evalúa en
  una función pura para que el runner pueda activar su mutante en la prueba PG.
  Se excluye de este alcance la guarda de tipos `null` de la comparación de
  fechas: sus variantes relacionales resultan equivalentes en JavaScript.
- Playwright: **5/5** recorridos reales HTTP/PG, incluidos selección de un
  chofer y vuelta a todos, cuatro tarjetas a 1500×800 y 1366×768, una quinta
  tarjeta con scroll del tablero, scroll interno de contenido,
  pantalla completa, persistencia, histórico, aislamiento, CSRF, revocación,
  reintento y recuperación sin SSE. Sin errores de página en Centro de control.
- Build, tipado y lint: verdes. `npm audit --omit=dev`: **0 vulnerabilidades**.
  Las capturas del navegador están en `.local/qa/control-center/`:
  `incidents-compact.png` y `four-screens.png`.
- Complejidad ciclomática ESLint del filtro compartido: **18** (selección de
  alcance, validación de fecha/UUID y cursor). Umbral de referencia 10;
  advertencia medida, no oculta. No se añadió autorización condicional en UI;
  las ramas nuevas de selección de alcance y cursor están cubiertas por las
  23 mutaciones detectadas. Defectos reproducibles locales tras la regresión: 0.
- Muestra local de latencia de telemetría POST→lectura admin: **414 ms** en
  este pase. Incidencia móvil visible por canal en **247 ms** y recuperación
  sin SSE en **14,999 ms**. Son muestras de fixture local, no latencia celular
  ni SLO de producción. El ajuste visual no añade peticiones ni cálculo Maps.

## Seguridad, límites y siguiente QA

La lectura viva sigue exigiendo administrador autenticado y el filtro SQL es
parametrizado; acciones, evidencias y cursor mantienen sus permisos y
aislamiento. La prueba de navegador deshabilita la clave de Maps y verifica
el fallback real; no certifica tiles ni marcadores con la clave de develop.
La liquidación/cierre formal de ruta aún no existe: cuando se construya, debe
retirar la ejecución del alcance vivo sin eliminar su auditoría. No presentar
estas pruebas locales como un Deploy o como certificación de producción.

Tras un Deploy de develop autorizado por separado, verificar con cuatro
pantallas en un monitor real: dos choferes filtrados, incidencias del día
anterior de ruta vigente, scroll dentro de cada ficha, abrir fotografía y
volver desde fullscreen. En móvil/tablet o viewport menor de 1001×680 px,
comprobar desplazamiento legible sin pérdida de controles.
