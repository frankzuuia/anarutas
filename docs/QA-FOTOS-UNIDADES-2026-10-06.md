# Fotos de unidades: treinta días y barrido diario

## Alcance aprobado

El propietario solicitó ampliar exclusivamente la retención de fotos de unidades
de quince a treinta días y su barrido de una hora a veinticuatro horas. Aclaró
expresamente que las otras evidencias son independientes. El bloque se entrega
en `develop`; no autoriza despliegue ni borrado de datos remotos.

## Contrato y diagnóstico

La carga escribía `captura + 15 días`, la base tenía el mismo valor por defecto,
y el recolector de huérfanos usaba quince días más una hora de margen. Cambiar
solamente el temporizador o el texto del panel no ampliaba la conservación.
El temporizador compartido coordinaba también evidencias de incidencias, por
lo que no se cambia su frecuencia: sólo el trabajo de unidades tiene un plazo
independiente de 24 horas y retorna sin I/O de unidades en los demás ticks.

- Migración 44 transaccional: default de treinta días y extensión de filas cuyo
  vencimiento coincide exactamente con la política anterior, contando desde
  su captura. Conserva identidad, hash, auditoría y bytes. No recrea fotos
  borradas ni altera vencimientos explícitos distintos.
- Acceso móvil/admin denegado al vencer treinta días, aun si el worker está
  detenido. La retirada física puede esperar al siguiente barrido diario.
- Barrido inicial de recuperación a los diez segundos del arranque, como antes;
  luego cada 24 horas por proceso. Un fallo deja el trabajo pendiente para
  reintentar al siguiente tick de coordinación. No es una tarea diaria durable
  compartida entre réplicas: reinicios pueden adelantar un barrido de recuperación.
- Se drenan vencidos en lotes de 200 con `FOR UPDATE SKIP LOCKED`. La exclusión
  local evita solapamiento; la base evita reclamar dos veces una fila entre
  procesos. Los huérfanos sólo se retiran si son WebP generados, tienen más de
  treinta días más una hora y ya no tienen referencia en la tabla de unidades.
- El directorio de incidencias y los documentos del chofer no se recorren.
  No se modifica la retención ni el limpiador de evidencias de incidencias.
- El panel informa treinta días. La APK consume el contrato existente;
  no requiere compilación ni actualización de Android para esta política.

## Evidencia reproducible

Ejecutar en Node 24 desde la raíz del repositorio:

1. `npm run build`, `npm run typecheck`, `npm run lint`.
2. `npx vitest run --config vitest.unit-photo-retention.config.ts --coverage`.
3. `node scripts/verify-unit-photo-retention-mutations.mjs`.
4. `npx playwright test tests/e2e/driver-mobile.spec.ts`.
5. Regresión de las versiones de esquema y consumidores de imágenes:

```powershell
$files = @(
  'customer-unloading', 'customer-windows-daily', 'driver-incidence-schema',
  'driver-mobile-phone-migration', 'driver-route-completion', 'driver-service-commands',
  'financial-store', 'fleet', 'google-consumption-persistence', 'live-eta-integration',
  'live-warehouse-integration', 'orders', 'plan-creation-migration',
  'product-incident-admin-cancel', 'product-incident-photos', 'product-incidents',
  'recalculation', 'route-publication-revisions', 'route-publications',
  'unit-photo-retention', 'product-incidents-evidence', 'document-body', 'product-thumbnails'
) | ForEach-Object { "tests/$_.test.ts" }
node node_modules/vitest/vitest.mjs run @files --reporter=dot --reporter=json --outputFile=reports/unit-photo-regression.json
```

6. `npm audit --omit=dev --audit-level=high`; `npm audit --json` para inventario completo.

Se usaron PostgreSQL 17 aislado, imágenes procesadas por Sharp, archivos privados,
servidor Next compilado y Chrome reales. Los timestamps se preparan como datos
de prueba en esa base; no se falsifican timers, APIs ni filesystem. No se llama
a Odoo, Google ni a una base desplegada para este cambio.

Gherkin: `tests/acceptance-unit-photo-retention.feature`, cubierto por las pruebas
citadas; no se declara ejecución de Cucumber. Se actualiza también el escenario
de retención de `tests/acceptance-route-publication.feature`.

## Métricas

| Puerta | Resultado |
| --- | --- |
| Pruebas dirigidas y publicación | 12/12, incluyendo once casos nuevos con PostgreSQL/filesystem |
| Cobertura de líneas del alcance | 95.13% (137/144) |
| Cobertura de ramas | 88.63% (78/88) |
| Cobertura de sentencias | 90.53% (153/169) |
| Cobertura de funciones | 77.77% (21/27) |
| Política, migración y programador nuevos | 100% líneas, ramas, funciones y sentencias |
| Complejidad ESLint | Programador 4; migración 1; barrido 11 |
| Mutation testing | 12/12 mutaciones detectadas; baseline de once pruebas verde, repetido con Sharp corregido |
| Regresión | 23 archivos, 108 pruebas correctas, una opt-in de Odoo omitida; 512.27 s |
| E2E | 2/2 recorridos Chrome/HTTP reales correctos; 59.9 s |
| Build y TypeScript | Correctos |
| Lint | Cero errores; advertencia heredada de exportación anónima en `stryker.product-amendments.config.mjs` |
| Auditoría de dependencias productivas | Cero vulnerabilidades |

El umbral exige 100% en los archivos nuevos y 95% de líneas/85% de ramas/90%
de sentencias en el alcance agregado. El 75% mínimo de funciones agregadas
reserva los callbacks defensivos heredados de carreras de filesystem que no
se fuerzan con mocks. Todos los métodos públicos y decisiones nuevas están
ejercitados; además se prueban un fallo real de `unlink`, almacenamiento ausente,
rollback, aislamiento de chofer, reintento, concurrencia y acceso vencido.
No se persigue un promedio global a costa de omitir el borrado crítico.

La prueba dirigida inicial midió 36 ms para retirar 405 metadatos vencidos
con dos recolectores concurrentes; el entorno local no representa un SLO de
producción ni una carga de 405 imágenes reales. Fuera del plazo diario, la
clase sólo compara dos valores en memoria y no consulta la base ni el volumen.
El número normal de barridos por proceso pasa de 24 a uno al día.

La prueba opt-in omitida lee miniaturas de productos en Odoo remoto; no cubre
la carga de fotografías de unidades ni la migración. Este bloque no cambia
el conector Odoo. Las demás verificaciones de miniaturas, documentos, fotos
e incidencias con el procesador actualizado terminaron correctamente.

El E2E inicial encontró dos pasos heredados desactualizados: al republicar
esperaba el texto final antes de comprobar las respuestas HTTP, y en celular
intentaba seleccionar una sección sin abrir el menú lateral. Se añadieron
esperas explícitas al recálculo (202, contrato real) y publicación (200), y
apertura del menú antes de seleccionar la sección. No se tocó la lógica de
publicación ni el menú productivo. La repetición completa pasó ambos recorridos,
incluyendo cinco fotos, renderizado de imágenes y texto de treinta días en
Control de unidades. Captura revisada: `reports/screenshots/unit-control-390.png`.

Artefactos ignorados por Git: `reports/unit-photo-regression.json`,
`reports/mutation/unit-photo-retention.json`,
`reports/coverage/unit-photo-retention/coverage-summary.json`,
`reports/unit-photo-audit.json` y `reports/screenshots/unit-control-390.png`.

## Seguridad y límites de entrega

La auditoría detectó `sharp@0.35.4` afectado por
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
Se fija `0.35.5` con sus binarios/libvips correspondientes en el lockfile,
sin actualizaciones ajenas al árbol de esa dependencia. Auditoría productiva:
cero alertas. Se repiten build y verificaciones de fotos con la versión corregida.

La auditoría completa conserva las cinco alertas de desarrollo de
`braces`/`micromatch`/`fast-glob`/ESLint de Next ya exceptuadas explícitamente por
el propietario para subir a `develop` sin desplegar, documentadas en
`QA-TIEMPO-ENTRE-PARADAS-2026-10-05.md`. No hay nuevas alertas productivas.

La migración se ejecutará por el arranque habitual al desplegar. No mantener
un limpiador del build anterior funcionando sobre el mismo volumen durante
la actualización: su barrido de quince días no conoce la nueva política.
El propietario controla el despliegue; no se modificó ninguna instalación remota.
