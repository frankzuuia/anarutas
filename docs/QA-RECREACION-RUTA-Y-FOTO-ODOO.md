# BL-152 — recreación de rutas y foto Odoo

Fecha: 2026-09-29. Rama: `develop`, sobre `ecce5d6`.
Alcance aprobado: corregir los dos fallos, sin modificar reglas de operación,
la ruta remota reactivada por el propietario, otros proyectos ni `main`.
Trabajo guiado por la revisión forense master-architect.

## Causa y corrección

1. Quitar una camioneta elimina su publicación por FK, pero preserva ejecuciones.
   La siguiente publicación usaba otra vez revisión 1. La ejecución antigua se
   volvía a asociar por `(plan_id, vehicle_id, publication_revision)` y sus
   correcciones aparecían como `point_corrected` antes de iniciar. No se atribuye
   este fallo al tiempo de cálculo de Google ni a las miniaturas.
2. En la lectura real del producto reportado, Odoo devolvió un WebP de 860×860
   píxeles y 24,536 bytes bajo `image_128`. El límite anterior de 262,144 píxeles
   rechazaba la foto antes de reducirla. Los otros productos comprobados sin
   foto mantienen correctamente el logo de respaldo.

Migración aditiva 31: máximo durable por plan/camioneta, sembrado desde
publicaciones, ejecuciones y auditorías, conservado mediante trigger transaccional.
La publicación usa máximo+1 bajo el bloqueo existente del plan. No se modifica
`route-start.ts`, la protección de rutas iniciadas ni Android. Una publicación
idéntica no consume revisión. Los pedidos, sus cantidades, incidencias, evidencias,
permisos y fecha/fotos necesarias para iniciar conservan las reglas existentes.

La imagen admite hasta 4096² píxeles de entrada, conserva base64 máximo de
180,000 caracteres y produce WebP de hasta 128 píxeles/65,536 bytes sin metadata.
No se consulta una URL proporcionada por el cliente. Se conservan autenticación,
asignación, revisión, origen Odoo y caché privado con revalidación de permisos.

## Evidencia

| Puerta | Resultado |
| --- | --- |
| Regresión específica PostgreSQL | 3/3: recreación iniciada y no iniciada, concurrencia, reintento, rollback, migración30→31, máximos y preservación histórica |
| Servicio/imagen, incluyendo Odoo real | 6/6, junto a las 3 anteriores: 9/9 sin omitir la integración Odoo |
| HTTP/E2E sobre build real | 3/3: móvil, inicio/reinicio/cancelación, sesión, aislamiento y miniatura real |
| TypeScript / build Next / bundle de migración | Aprobados |
| ESLint | 0 errores; advertencia previa de export anónimo en stryker.product-amendments.config.mjs |
| Dependencias de producción | 0 vulnerabilidades, npm audit --omit=dev --audit-level=high |
| Regresión general | 661 aprobadas, 1 timeout, 2 omitidas, en 68 archivos/909.45 s; el timeout pasó en repetición aislada |
| Mutaciones críticas | 15/15 detectadas: 4/4 Stryker y 11/11 SQL semánticas; 0 sobrevivientes y 0 timeouts |

La ejecución general registró un timeout de 30 s en `postgres-lifecycle.test.ts`
(limpieza del PostgreSQL temporal). Repetición aislada sin cambios de código,
sin relajar timeout ni aserciones: **1/1 aprobada en 10.9 s**. Se conserva el
fallo inicial como evidencia; no se atribuye sin pruebas a la lógica de negocio.
Las dos omitidas de la suite general son las integraciones condicionadas por
entorno: Odoo se ejecutó y aprobó por separado con credenciales de sólo lectura;
FCM no se ejecutó y no forma parte del cambio. La suite completa no se presenta
como verde en un solo intento; todos sus casos no omitidos tienen una ejecución
aprobada, conservando la salvedad del timeout de infraestructura.

Cobertura dirigida (no global): **38/38 líneas (100%)**, **10/10 funciones
(100%)**, **48/51 statements (94.11%)**, **31/35 ramas (88.57%)**. Los dos módulos
de revisión tienen 100% de cobertura TS, pero SQL es opaco al contador de V8:
se valida además con PostgreSQL y mutaciones semánticas explícitas.

Objetivo por riesgo: cubrir cada invariante de identidad, migración y seguridad,
con 100% de líneas nuevas y mutaciones detectadas. Las ramas defensivas no
alcanzadas del servicio de fotos (fila ausente, cambio durante consulta, salida
WebP inesperadamente grande) no se presentan como cubiertas. No hubo cambios
de lógica en ellas. Complejidad ciclomática ESLint: normalizador 7 (sin aumento),
asignador de revisión 1 y envoltura de migración 1; no mide la complejidad SQL.

Observación de latencia local, no p95/SLO de producción: ocho solicitudes
concurrentes con la foto real de Odoo completaron en **1,224 ms**. El E2E existente
observó evento de publicación en 207 ms e inicio en 309 ms. No se modificaron
timeouts ni límites de Google. Los datos de cálculo guardados en pruebas de
publicación son fixtures explícitos: no simulan una respuesta HTTP ni certifican
cálculos reales de Google.

## Procedimiento reproducible

Node 24 y dependencias del proyecto, PostgreSQL aislado real. Para integración
Odoo, suministrar sólo las variables Odoo mediante el mecanismo privado y dos
IDs verificados en esa instalación mediante `RUTAS_TEST_IMAGE_PRODUCT_ID` y
`RUTAS_TEST_NO_IMAGE_PRODUCT_ID`. Sin dichas variables la prueba Odoo se omite;
la ejecución registrada arriba sí utilizó Odoo real, exclusivamente en lectura.

```powershell
npm run typecheck
npm run lint
npm run build
npx vitest run --maxWorkers=2
npx vitest run tests/product-thumbnails.test.ts tests/route-publication-revisions.test.ts --coverage --coverage.include=src/core/product-thumbnails.ts --coverage.include=src/core/route-publication-revisions.ts --coverage.include=src/core/route-publication-revisions-schema.ts --coverage.reportsDirectory=coverage/route-fixes
npx playwright test tests/e2e/product-thumbnails.spec.ts tests/e2e/driver-mobile.spec.ts --workers=1
npx stryker run stryker.route-fixes.config.mjs
node scripts/verify-route-revision-mutations.mjs
npm audit --omit=dev --audit-level=high
```

El runner de mutaciones SQL copia sólo código/pruebas a un directorio temporal
de QA, verifica primero la línea base, altera fragmentos exactos y exige fallo
de pruebas, no sólo un proceso fallido. Usa PostgreSQL real y no toca el árbol
activo ni bases remotas. Evidencias: `coverage/route-fixes/coverage-summary.json`,
`reports/mutation/route-fixes.json`, `reports/mutation/route-revision-sql.json`,
`test-results/` y `playwright-report/`. Aceptación RF01..08 en
`tests/acceptance-route-recreation.feature`.

## Entrega y límites

- No se ha desplegado ni modificado la ruta remota. La reparación previene la
  colisión en futuras recreaciones; no reescribe ejecuciones ya realizadas.
- Compatible con la APK 0.8.4 existente. No necesita otra APK ni republicar la
  ruta que el propietario ya reactivó. El caché previo de ausencia de fotos
  expira automáticamente en hasta 15 minutos tras actualizar el servidor.
- La migración se ejecuta con el procedimiento de arranque existente. Es
  aditiva, preserva rutas iniciadas y no exige intervención operativa manual.
  Después de migrar, un servidor viejo que sólo acepta schema30 no puede
  arrancar: cualquier reversión necesita conservar compatibilidad con schema31.
- La validación física de la foto en el teléfono sigue a cargo del propietario;
  HTTP/bytes reales no se presentan como una prueba visual Android.
- Commit/push de este bloque a `develop` autorizados expresamente por el
  propietario el 2026-09-29, después de informar los resultados y la salvedad
  del timeout aprobado al repetirlo. Deploy siempre manual del propietario.
- Credencial temporal de lectura Odoo retirada del disco al terminar las pruebas;
  no se incluyen secretos en código ni documentación.
