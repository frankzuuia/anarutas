# QA — Barra compacta y mutación del canal en vivo

Fecha: 26/09/2026. Rama `develop`. Bloques BL-134 / CC16 y BL-135 / RT09.
Alcance: presentación del tablero, conexión de «Actualizar» y regresiones del
canal SSE. No requiere esquema, endpoint, permiso o APK nuevos. El usuario
autorizó commit/push a develop; Deploy permanece fuera de esta ejecución.

## Autopsia y resultado visible

El encabezado genérico (`Dashboard`) y la fila de estado/«Agregar pantalla»
(`ControlCenter`) consumían dos niveles verticales separados. Una sola barra
del Centro de control reúne título de 18 px, ayuda, estado de guardado,
«Agregar pantalla» y «Actualizar». En captura Playwright de 1500×800, el borde
superior de las tarjetas queda aproximadamente en **y=110 px**, frente a
**y=195 px** en la captura de referencia del usuario: unos **85 px** más para
la operación. La prueba exige `y < 145 px` y que los controles estén alineados
en una misma fila. Con cuatro pantallas siguen visibles los cuatro marcos a
1500×800 y 1366×768 sin scroll de página. A 720 y 390 px los controles siguen
visibles sin desbordamiento horizontal.

La auditoría de mutación encontró huecos de prueba en el canal de eventos:
latido tras un cambio, suscripción PG heredada, fallo de `LISTEN`, clasificación
de errores y temporizador tras abort durante autenticación. Se ejercitan con
PostgreSQL real y una función pura para distinguir exclusivamente `AppError`
401. La prueba de recursos observa temporizadores reales mediante `async_hooks`;
verifica tanto su creación normal como su eliminación al cerrar. No sustituye
timers, pool ni autenticación. La clasificación duplicada del SSE se concentra
en una función y la salida tras cierre queda explícita.

## Reproducción y evidencia

Desde la raíz del repositorio, con las dependencias existentes:

```powershell
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/control-center.spec.ts
npx playwright test tests/e2e/panel.spec.ts
npx vitest run tests/live-tracking.test.ts tests/panel-events.test.ts --coverage --coverage.include=src/core/live-routes.ts --coverage.include=src/core/panel-events.ts --coverage.include=src/core/panel-event-stream.ts
npx stryker run stryker.panel-events.config.mjs
npm audit --omit=dev --json
git diff --check
```

- Build, TypeScript y ESLint: verdes.
- Playwright: **3/3** pruebas HTTP/UI con PostgreSQL aislado real. El clic en
  «Actualizar» obtuvo HTTP 200 de `/api/live-routes` y `/api/incidents/live`;
  la distribución, filtros, selector, foco, expansión y cuadrícula conservaron
  sus contratos. La regresión del panel general también pasó.
- Vitest dirigido final: **20/20**, incluidas **12** pruebas del canal SSE/PG.
  Cobertura conjunta de los contratos observados: **95.27% statements**,
  **88.4% ramas**, **97.14% funciones**, **96.39% líneas**. `panel-events.ts`
  tiene **100% líneas** y `panel-event-stream.ts` **93.22%**. Las cuatro líneas
  restantes son cierres defensivos por desconexión durante suscripción; el
  abort durante autenticación y los contratos de seguridad sí se verifican.
  Objetivo de riesgo: al menos 85% líneas y 80% ramas para los contratos
  dirigidos; no se introdujo lógica de negocio nueva. El primer intento con
  sólo estos 17 tests y cobertura de todo el repositorio produjo **22.06% de
  líneas** y salida 1 por umbral global, aunque las 17 pruebas pasaron. Se
  repitió con el alcance explícito anterior; no se presenta el primer resultado
  como puerta global verde.
- Mutación inicial: **82.22%**, siete supervivientes y uno sin cobertura.
  La clasificación de errores ahora se muta una vez como función compartida,
  manteniendo las llamadas y la zona de control/concurrencia original bajo
  mutación. La puerta configurada pasa de 80% a **100%**. El pase aislado de
  la guarda de cierre detectó **2/2** variantes, sin timeout. Resultado final
  completo: **43/43 detectados (100%)**, **41** por fallo de prueba y **2** por
  timeout; **0 supervivientes, 0 sin cobertura, 0 errores**. Se conserva en
  `reports/mutation/panel-events.json`. Se muta el mismo alcance operativo
  anterior más la clasificación compartida; no se excluyeron supervivientes.
- Supply chain: `npm audit --omit=dev` encontró **0 vulnerabilidades**.
- Complejidad ciclomática medida mediante ESLint: máximo **6** por función
  del módulo SSE; clasificador compartido **2**. Sin nuevas consultas ni
  estados persistidos.
  Defectos reproducidos en la regresión dirigida: **0**. El muestreo local de
  telemetría HTTP POST→lectura fue **380 ms**; no es un SLO de red móvil ni de
  producción. El cambio visual no añade consultas salvo el refresco solicitado.
- Seguridad: E2E verifica 401 sin sesión, rechazo 403 de origen ajeno y que la
  vista nueva no altera el aislamiento de rutas. No se agregaron secretos ni
  endpoints. La prueba desactiva la clave de Maps y valida el fallback real,
  no los tiles de Google en develop.

Capturas locales: `.local/qa/control-center/incidents-compact.png`,
`.local/qa/control-center/four-screens.png`, `.local/qa/control-center/narrow.png`.
Son evidencia reproducible, no un despliegue.
