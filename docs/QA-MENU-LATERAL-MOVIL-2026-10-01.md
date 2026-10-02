# QA — BL189, menú lateral móvil

Bloque aprobado por el propietario el2026-10-01. Raíz `ana-rutas`, rama
`develop`, origen del trabajo `e5f6c9c`. Contrato NM01..12 en
MENU-LATERAL-MOVIL-2026-10-01.md. Sólo presentación web: mismos destinos,
permisos, filtros y comandos; sin cambios de API, SQL, dependencias o APK.

## Resultado y evidencia

| Puerta             | Resultado                                                                                                                       | Evidencia local                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Unidad             | 26/26:12 geometría,14 límites de teclado                                                                                        | `.local/qa-mobile-navigation-unit.json`                                                                               |
| Cobertura nueva    | 100% líneas6/6, sentencias8/8, ramas12/12, funciones2/2                                                                         | `coverage/mobile-navigation/coverage-summary.json`                                                                    |
| Mutación           | 33/33 detectadas;20 geometría,13 foco;0 supervivientes/no cubiertas/timeouts                                                    | `reports/mutation/mobile-navigation.json`                                                                             |
| E2E del menú       | 3/3: rutas, liquidación y pantalla táctil                                                                                       | `.local/qa-mobile-navigation-final-menu.json`                                                                         |
| Regresión real     | 7/7: cinco Centro de control/live, dos liquidación completa con/sin bodega                                                      | `.local/qa-mobile-navigation-final-e2e.json`, casos ajenos a mobile-navigation                                        |
| Consolidación      | 10 recorridos únicos verificados,0 fallos pendientes                                                                            | `.local/qa-mobile-navigation-verified.json`                                                                           |
| TypeScript/build   | Ambos exit0, build de producción                                                                                                | `.local/qa-mobile-navigation-typecheck.log`, `qa-mobile-navigation-build.log`                                         |
| Lint               | 0 errores/advertencias en archivos TypeScript modificados; global0 errores,1 advertencia anterior en stryker.product-amendments | `.local/qa-mobile-navigation-focused-lint.log`, `qa-mobile-navigation-test-lint.log`, `qa-mobile-navigation-lint.log` |
| Supply chain       | 0 vulnerabilidades de producción, ninguna dependencia nueva                                                                     | `.local/qa-mobile-navigation-audit.json`                                                                              |
| Complejidad        | Helper geométrico4; foco5; componente1, callbacks máximo4                                                                       | `.local/qa-mobile-navigation-complexity.json`                                                                         |
| Errores JavaScript | 0 en las dos cuentas del recorrido principal                                                                                    | `.local/qa-mobile-navigation/metrics-*.json`                                                                          |
| Apertura observada | 8 muestras por rol; p95/máximo rutas102.11ms, liquidación59.20ms                                                                | mismos archivos de métricas                                                                                           |

La cobertura100% corresponde exclusivamente a los dos contratos puros nuevos,
justificada por su pequeño tamaño y por el riesgo de cerrar un gesto incorrecto
o sacar el foco del modal. No se atribuye ese porcentaje al componente React ni
al sistema financiero. Los callbacks se validan en navegador real; el flujo
financiero conserva su suite de regresión. No hay código monetario modificado
que requiera repetir su campaña de mutación.

La latencia incluye click/assert de Playwright en esta PC; no es una medición
de carga ni un SLO de red/dispositivo. Playwright1.63.0 con Chrome,
Next16.3.8/React19.2.8, Node24.18.0 y PostgreSQL aislado. Sin llamadas Odoo/Google ni APIs simuladas:
las cuentas, datos, cambios en vivo y endpoints usan la aplicación y PG reales.

## Casos comprobados

- NM01..02: cerrado al entrar, barra superior en y0,300px a la izquierda en390px,
  lista única de13 opciones compartidas con PC y controles mínimos44px.
- NM03..04: X, Escape, selección y toque fuera; foco de regreso; toque interno
  y arrastre dentro→fuera no cierran. Táctil sin click transmitido al fondo.
- NM05..07: opciones habilitadas según rol y403 HTTP conservados; Tab/ShiftTab
  recorren y cierran el ciclo dentro del menú. Fondo sin interacción ni scroll.
- NM08..10:320/390/720/721/1280px, altura420px, texto realmente ampliado a20px,
  scroll sólo del cajón, X visible, sin desborde lateral; cambio a PC libera
  scroll/foco y conserva el estado independiente del sidebar desktop.
- NM11..12: SSE real no remonta el diálogo ni pierde foco; filtro de chofer
  conservado. Los paneles embebidos no añaden menú/trigger. Regresión de mapas,
  roles, distribución, tickets, recepción individual y ruta completa.

Capturas revisadas visualmente en `.local/qa-mobile-navigation/`: open, closed,
narrow y desktop de ambos roles. Es QA responsive con Chrome y eventos táctiles
reales del navegador; no certifica hardware Android/iOS o todos sus navegadores.
Gherkin: `tests/acceptance-mobile-navigation.feature`.

## Defectos detectados y recuperación

1. Menú original arriba del contenido: CSS móvil mantenía sidebar en el flujo,
   nav flex-wrap y estado inicial abierto. Ahora estado móvil cerrado, diálogo
   lateral y navegación compartida; escritorio conserva su sidebar.
2. Cerrar en pointerup perdía foco después de un toque táctil. Se conserva el
   diálogo durante los eventos de compatibilidad y se cierra al activar click,
   validando inicio/fin fuera. La prueba táctil reproduce y previene el fallo.
3. Recorrer toda la lista con Tab podía salir del modal. Límites explícitos entre
   botones habilitados, probados con14 casos,13 mutaciones y ciclos reales.
4. El test anterior de Centro de control navegaba sin abrir menú a720px. Se
   actualiza a ☰→opción; se conservan todas sus aserciones funcionales y se agregan
   controles contra menús duplicados en pantallas embebidas.
5. La última matriz completa dejó9/10 verdes: el test de liquidación midió antes
   de que Playwright desplazara al trigger que el propio test había sacado de
   pantalla. Se mide con ☰ visible, antes de abrir, y se conserva la comparación
   geométrica y de scroll. Revalidación del archivo completo:3/3 verdes en28.5s,
   sin cambios de producción respecto a los7 recorridos de regresión verdes.
   La consolidación verifica los10 resultados únicos aprobados y conserva los
   reportes anteriores; no se presenta aquella matriz como10/10 en una corrida.

## Reproducción

Desde la raíz, Node24 y dependencias del lock instaladas, ejecutar en PowerShell:

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd run lint
node node_modules/vitest/vitest.mjs run --config vitest.mobile-navigation.config.ts --coverage
npm.cmd exec -- stryker run stryker.mobile-navigation.config.mjs
$env:PLAYWRIGHT_JSON_OUTPUT_FILE='.local/qa-mobile-navigation-reproduced.json'
node node_modules/@playwright/test/cli.js test tests/e2e/mobile-navigation.spec.ts tests/e2e/control-center.spec.ts tests/e2e/settlements.spec.ts --reporter=json
npm.cmd audit --omit=dev
```

E2E inicia build de producción y PG dedicado con puertos/identidades únicos,
migra, autentica y limpia sus recursos. No requiere secretos ni acceso a datos
productivos. No ejecutar estos comandos contra bases de otro entorno.
Validación manual adicional: abrir sitio en celular, ☰, elegir sección, reabrir,
X/tocar fuera; girar y volver a PC; confirmar lista vertical y espacio libre.

Entrega autorizada a develop. Despliegue manual del propietario; sin main,
cambios financieros o recompilación Android. Rollback sólo de presentación,
compatible con el esquema y datos actuales.
