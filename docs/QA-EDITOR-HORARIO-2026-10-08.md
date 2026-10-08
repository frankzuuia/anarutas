# Editor de horario debajo de Prioridad — 08/10/2026

## Alcance aprobado

El propietario pidió mover Ventanas de horario debajo de Prioridad, retirar
«+ Añadir ventana» y entregar commit/push a develop para su deploy manual.
Confirmó el bloque que conserva la captura en clientes sin horario, el borrado
y la recaptura, con regresión de guardado y visualización móvil.

## Diagnóstico y cambio

El editor dibujaba exclusivamente `form.windows`. Quitar sólo el botón de
creación dejaría sin campos a clientes con cero ventanas, incluidos los nuevos.
Se mueve el fieldset existente y se muestra una fila visual vacía cuando el
estado no tiene ventanas. Esa fila no ensucia el formulario ni se envía al
servidor si no se edita. Capturar una hora activa la validación requerida de
ambos campos; capturar las dos reutiliza el PATCH existente. La papelera
conserva la operación anterior de quitar horarios.

No se recortan ventanas anteriores ni se cambia su validación. Los clientes
con más de una mantienen sus intervalos. No se modifica API, esquema,
migración, ruteo, Google, Odoo, exportador, descarga, APK ni base desplegada.
El único archivo de aplicación modificado es `src/components/customer-panel.tsx`.

## Procedimiento reproducible

Desde la raíz del repositorio con Node 24 y dependencias instaladas:

```powershell
npm run typecheck
npm run lint
npm run build
node node_modules/vitest/vitest.mjs run tests/customers-validation.test.ts tests/customers.test.ts tests/customer-windows-daily.test.ts tests/customer-unloading.test.ts --coverage --coverage.include=src/core/customers-validation.ts --coverage.reportsDirectory=reports/coverage/customer-window-editor --coverage.thresholds.lines=85 --coverage.thresholds.statements=85 --coverage.thresholds.functions=90 --coverage.thresholds.branches=80 --reporter=dot --reporter=json --outputFile=reports/customer-window-contracts.json
node node_modules/@stryker-mutator/core/bin/stryker.js run stryker.customers.config.mjs --mutate src/core/customers-validation.ts:36-75
node node_modules/@playwright/test/cli.js test tests/e2e/customer-unloading.spec.ts tests/e2e/panel.spec.ts --reporter=list --output=test-results/customer-window-editor-verified
npm audit --omit=dev --json
git diff --check
```

PostgreSQL 17 aislado, HTTP, sesión y Chrome reales con el build Next 16.3.8.
No se sustituyen APIs con mocks ni se conecta a una base remota. La prueba de
descarga construye el contrato Google sin hacer una llamada externa.
Gherkin en `tests/acceptance-customer-windows-daily.feature`; se ejecutan sus
contratos mediante Vitest/Playwright, no mediante Cucumber.

## Casos y evidencia

| Caso | Resultado comprobado |
| --- | --- |
| VE01 | Prioridad → Ventanas → Descarga → Modalidad; sin botón Añadir, en 1440 y 390 px |
| VE02 | Campos vacíos sin cambios; guardar sólo una nota mantiene cero ventanas |
| VE03 | Quitar ambas ventanas, guardar vacío, recargar y recapturar 11:00–13:00; PostgreSQL confirma 660–780 |
| VE04 | Una sola hora y 24:00 bloquean el envío en Chrome; el contador de PATCH no avanza |
| VE05 | Dos ventanas anteriores sobreviven al cambio de nota; prioridad, descarga, modalidad, nombre, teléfono, domicilio, Maps, coordenadas y estado del punto iguales |
| Seguridad/regresión | Origin ajeno 403, sin sesión 401, liquidador 403; dos sesiones, versiones, archivo/restauración, Excel, reinicio y conservación de datos |

Artefactos locales ignorados por Git:

- `reports/customer-window-contracts.json`.
- `reports/coverage/customer-window-editor/coverage-summary.json` y HTML.
- `reports/mutation/customers.json` y HTML.
- `reports/screenshots/customer-window-1440.png` y `customer-window-390.png`,
  revisados visualmente.

## Métricas y puertas

| Métrica | Resultado |
| --- | --- |
| Unitarias/contratos/PG | 13/13, cuatro archivos, 50.85 s |
| Cobertura del validador reutilizado | 88.70% líneas, 89.04% sentencias, 89.28% ramas, 100% funciones |
| Objetivo dirigido | ≥85% líneas/sentencias, ≥80% ramas, ≥90% funciones; cumplido |
| Mutación de reloj/intervalos | 82/82 detectadas; cero supervivientes, sin cobertura, errores o timeouts |
| Chrome final | 3/3 en 52.6 s; editor/descarga 2.5 s, horario 2.4 s, panel completo 25.4 s |
| Errores de navegador | Cero en las comprobaciones del editor |
| Desbordamiento horizontal | Cero en móvil y escritorio comprobados |
| Complejidad del componente | Estimación AST de función principal 37 → 38; una alternativa visual añadida, callbacks anidados excluidos |
| I/O nuevo | Cero endpoints, consultas o llamadas externas nuevas; se conserva el guardado existente |
| Build / tipos | Correctos |
| Lint | Cero errores; un warning heredado en `stryker.product-amendments.config.mjs` |
| Auditoría productiva | Cero vulnerabilidades |
| Auditoría completa | Cinco alertas heredadas de herramientas ESLint/braces; dependencias sin cambios |

La cobertura reportada corresponde al contrato del servidor, no al porcentaje
del JSX. La presentación y estados nuevos están validados en Chrome, incluidos
datos vacíos y persistencia real. No se alteran reglas críticas del dominio.
Las duraciones son ejecuciones locales completas; no son una medición de
latencia de producción ni un SLO productivo.

Las cinco alertas de desarrollo son las mismas para las que el propietario ya
autorizó explícitamente la entrega a develop con excepción documentada.
No se instala una versión incompatible ni se modifica el lockfile. Esta entrega
no certifica despliegue productivo y no toca main.

## Fallos detectados durante QA

La primera ejecución Chrome dio 1/3: el test nuevo buscaba la nota por texto
exacto del label después de recargar un textarea con contenido; la regresión
general usaba `locator("dialog")`, que también incluía el menú móvil cerrado.
El snapshot real mostró que la nota existía y los campos estaban conservados.
Se corrigen sólo los selectores de las pruebas: rol textbox con nombre accesible
y rol dialog visible. Se conservan las mismas aserciones de contenido, tamaño y
seguridad. La repetición completa terminó 3/3 sin reintentos automáticos.

## Entrega y reversión

Commit/push sólo a develop, autorizados por el propietario. El despliegue en
EasyPanel lo realiza el propietario. Para revertir la presentación basta
revertir este commit; no hay migración ni datos que restaurar. No se sincroniza
Odoo ni se altera la instalación de desarrollo mediante este bloque.
