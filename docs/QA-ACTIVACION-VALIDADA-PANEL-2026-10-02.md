# QA BL192 — activación validada en el panel

Fecha: 2026-10-02. Base develop f9cf224. Corrección solicitada del botón Activar
ruta, con aclaración explícita: Publicar rutas activa las camionetas completas y
avisa cuáles no pudo activar por pedidos pendientes. Contrato y Gherkin en
ACTIVACION-VALIDADA-PANEL-2026-10-02.md.

## Resultado y alcance

- Activación individual pendiente: botón y confirmación deshabilitados; POST
  directo 409 con los folios actuales de esa camioneta.
- Publicación conjunta: las completas se publican; las pendientes permanecen
  intactas y se devuelven en skippedValidationVehicles con nombre/ID y folios.
- Todas pendientes: cero cambios, sin afirmar una activación exitosa.
- Pendientes sin asignar y otras camionetas no bloquean la activación individual.
- Última validación habilita automáticamente; una confirmación abierta se bloquea
  si entra un pendiente. Servidor revalida bajo los locks existentes.
- Rutas iniciadas, revisión/idempotencia, roles, fotos, cancelación y errores por
  cancelados/sin productos conservados. Cargar/Armar siguen habilitados.
- Sin cambios Android, esquema, rutas HTTP, worker/configuración Odoo, planificación
  vial, pagos o liquidación. Sin APK nueva ni despliegue de producción.

## Evidencia ejecutada

| Puerta | Resultado |
| --- | --- |
| Unidad + PG real + regresión | 5 archivos, 10 pruebas aprobadas |
| PostgreSQL de activación | alcance, null/desconocidos, legado, permisos, publicación parcial, replay y concurrencia aprobados |
| Navegador Chrome/HTTP del panel | 1 recorrido aprobado, 3.3 s de prueba / 21.9 s total con instalación aislada |
| Regresión Chrome/HTTP móvil existente | 1 recorrido aprobado, 43.6 s; publicación rechazada hasta validar, fotos/inicio/incidencias/cancelación/recuperación conservados |
| Mutation testing dirigido | 10/10 detectados por assertions, baseline 2/2 aprobado, cero supervivientes |
| Cobertura de la política nueva | líneas 4/4, ramas 2/2, funciones 3/3, statements 4/4: 100% |
| Cobertura route-publications.ts | líneas 99.18%, ramas 91.08%, funciones 100%, statements 96.24% |
| Complejidad política nueva | medida con AST TypeScript, funciones [1, 2, 1], máximo 2 |
| TypeScript + ESLint de archivos afectados | aprobados, cero diagnósticos |
| Build Next 16.3.8 | aprobado; compilación 17.2 s y TypeScript 11.6 s |
| Diff / revisión independiente de alcance | aprobado; sólo panel, publicación, política, pruebas y documentación |

Latencia local observada: commit del dominio de sincronización → botón habilitado
por SSE/lectura: **221 ms**. Regresión móvil: validación visible 198 ms;
10 lecturas HTTP del contrato, p95/max 31.5 ms. Estas cifras empiezan cuando el
cambio ya llegó a PostgreSQL; no miden ni prometen el tiempo de consulta remota
Odoo. La cadencia aceptada por el propietario se conserva.

Defectos pendientes: 0 en el alcance. Se corrigieron errores del montaje de QA
(nombre de tabla de revisiones, creación de cuenta con rol inmutable, código SQL
de bloqueo y nombres accesibles existentes). No se alteraron las restricciones
productivas para que las pruebas pasaran. Un comando auxiliar Node con quoting
incorrecto no editó archivos; se sustituyó por apply_patch.

Los fixtures son entradas de dominio/recorridos calculados guardados en PostgreSQL
aislado, no endpoints simulados ni una afirmación de haber consultado Google u
Odoo en vivo. Se ejecutaron el dominio de sincronización, transacciones, eventos,
servidor Next, HTTP y navegador reales. No se escribieron datos de operación real.
El propietario despliega el cambio; pruebas locales no equivalen a deploy.

## QA reproducible

En la raíz real C:/Users/figod/Desktop/ana-rutas, con Node 24 configurado en PATH:

```powershell
node node_modules/vitest/vitest.mjs run tests/route-publication-validation.test.ts tests/route-publication-validation-integration.test.ts tests/route-publications.test.ts tests/draft-source-sync.test.ts tests/route-publication-content.test.ts --coverage --coverage.include=src/core/route-publication-validation.ts --coverage.include=src/core/route-publications.ts --coverage.reportsDirectory=reports/coverage-panel-validation
node scripts/verify-panel-validation-mutations.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/core/route-publication-validation.ts src/core/route-publications.ts src/components/orders-board.tsx src/components/api.ts tests/route-publication-validation.test.ts tests/route-publication-validation-integration.test.ts tests/helpers/publication-validation.ts tests/e2e/panel-route-validation.spec.ts tests/e2e/driver-mobile.spec.ts scripts/verify-panel-validation-mutations.mjs
node node_modules/next/dist/bin/next build
node node_modules/@playwright/test/cli.js test tests/e2e/panel-route-validation.spec.ts
node node_modules/@playwright/test/cli.js test tests/e2e/driver-mobile.spec.ts --grep 'admin provisioning'
git diff --check
```

La ejecución de cobertura documentada usó thresholds CLI=0 para inspeccionar el
archivo legado completo; los porcentajes finales superan las puertas configuradas
(85% líneas/statements, 90% funciones, 80% ramas). La política nueva cumple su
objetivo por riesgo de 100%. El único renglón de publicaciones sin cubrir es la
entrada inválida de scope ya existente, ajena a esta nueva guarda.

El runner de mutaciones copia código y fixtures a un directorio aislado bajo
.local, valida baseline, modifica una decisión por ejecución, exige fallo de
assertions y restaura la copia. No edita el árbol activo. Mutantes: bypass
individual, rechazo global incorrecto, publicación de pendientes, omisión de
completas, informe perdido, alcance ajeno, sólo primer pedido, lista vacía,
nombre equivocado y estados desconocidos permitidos.

Reportes locales reproducibles (ignorados por Git):

- reports/coverage-panel-validation/coverage-summary.json y HTML.
- reports/mutation/panel-validation.json.
- reports/screenshots/panel-activation-pending-desktop.png.
- reports/screenshots/panel-activation-pending-mobile.png.

Inspección visual realizada a 1440×1000 y 390×844: folios bajo la camioneta,
botón individual deshabilitado y modal completo con el motivo de bloqueo.
