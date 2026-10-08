# IO-T01 — contratos y reporte de incidencias

Fecha: 2026-10-08. Alcance autorizado: bloque 1, sólo develop.
Estado: IO-T01 verificado para entrega a develop; no desplegado.

## Cambio e integridad

- Formulario nuevo v3: catálogo por tipo, Error en compra en los cuatro tipos
  del reporte y devolución sin departamento/concepto; comentarios y fotos
  validados también en servidor. Multipart acepta v2 y v3.
- Comandos v2/legado conservan su normalización y recibos; el upgrade de la APK
  queda para IO-T02. No se reclasifica ningún registro antiguo ni se usa el Odoo
  de pruebas vencido. Los datos de las pruebas son nuevos y locales.
- Reporte, conteos, paginación y export excluyen devoluciones. El exportador
  `product-incidents-excel.ts` no se modificó: conserva columnas, tipos y estilo.
- Corrección administrativa mediante `comment` opcional en la API existente.
  Ausente conserva la corrección; null recupera el original; vacío explícito se
  conserva vacío. Reporte/vivo/Excel leen el efectivo; el chofer y auditoría
  conservan original. UI de este editor pendiente de IO-T03.
- Migración 46 amplía el motivo de bodega y crea
  `route_product_incident_annotations` con referencias a incidencia/usuario.
  No modifica filas históricas ni triggers financieros. Anotación, versión y
  auditoría se escriben en una misma transacción bajo bloqueo de incidencia.
- Rol de rutas y origen válido obligatorios; actor proviene de sesión. No se
  admiten cantidad, estado ni importes en el editor. Dos ediciones de la misma
  versión producen una ganadora y un conflicto, nunca una actualización perdida.

## Evidencia ejecutada

| Verificación | Resultado |
| --- | --- |
| Contratos nuevos, PG real, fotos, comentarios y carrera entre administradores | 4 pruebas nuevas aprobadas |
| Compatibilidad y contratos iniciales | 11 pruebas aprobadas; 100% líneas/ramas/funciones en formulario, política, migración nueva y multipart |
| Cobertura ampliada del servicio/finanzas | 34 pruebas aprobadas; 96.88% líneas, 96.51% ramas, 100% funciones, 96.18% sentencias |
| Regresión de migraciones y módulos afectados | 88 pruebas aprobadas en 19 archivos |
| Exportador sin cambios | 2 pruebas de formato exacto/seguridad aprobadas; repetición final de los 4 contratos nuevos también verde |
| Chrome + HTTP real | 3 E2E aprobadas: v3 y retorno fuera del reporte, flujo v2 completo, retiro administrativo tras cancelación |
| Mutaciones aisladas | 16/16 detectadas, baseline verde; ninguna superviviente |
| Regresión financiera dirigida | 4 pruebas aprobadas, incluida clasificación/comentario sin cambiar totales, líneas ni estados de cobro |
| Build | Correcto |
| TypeScript | Correcto |
| ESLint | 0 errores; advertencia heredada en stryker.product-amendments.config.mjs |
| Auditoría producción | 0 vulnerabilidades |
| Auditoría completa | Mismas 5 alertas heredadas de herramientas de desarrollo; dependencias intactas |

Las cinco alertas son @next/eslint-plugin-next, braces, eslint-config-next,
fast-glob y micromatch. La excepción para entrega a develop ya fue autorizada
por el propietario y documentada en QA-EDITOR-HORARIO-2026-10-08.md y
QA-ODOO-ARCHIVADOS-2026-10-08.md. No incluye deploy ni una excepción nueva.

### Métricas y límites

La primera pasada con el servicio completo dio 94.55% líneas y 95.05% ramas;
detectó falta de cobertura de contratos financieros anteriores. No se bajó el
umbral para aprobar: se añadieron las integraciones reales relacionadas.
Resultado final: 96.88% líneas, 96.51% ramas, 100% funciones, 96.18% sentencias.
Formulario, política, migración nueva y multipart permanecen al 100% medido.
El servicio completo conserva 94.4% líneas y 93.51% ramas; las ramas no cubiertas
son guardas previas fuera del cambio. La cobertura de una sentencia SQL ejecutada
no demuestra todos sus casos: se acompaña de pruebas reales de migración,
referencias, permisos, concurrencia, auditoría y rechazo de entradas.

Mutaciones: 16 de 16 detectadas (100% del conjunto dirigido). Incluyen contrato
v2, v3 deshabilitado, clasificación indebida de retorno, comentario incompatible,
duplicado, tamaño, campos financieros extra, foto ausente, retorno exportado,
corrección ignorada, vacío confundido con null, carrera y auditoría del actor.
Esto no es un mutation score de todo el repositorio.

Complejidad ESLint: máximo del servicio 48 antes/después (heredado, sin aumentar).
Formulario pasa 9→17 por coexistencia v2/v3 y catálogo por tipo; parser de entrada
22→25 por clasificación nula sólo en devolución v3. Revisión manual de ramas y
cobertura específica, sin reestructurar finanzas fuera del alcance aprobado.

Una corrección por HTTP local tardó 39 ms; la prueba v2 midió 249 ms para un
conjunto de creación/reintento/conflicto. Son muestras locales, no p95 de producción.
Veinte lecturas consecutivas de cuatro filas en PostgreSQL aislado: p50 1.67 ms,
p95 2.08 ms. Se registra en `.local/io-read-latency.json`. No es una prueba de carga
representativa de producción ni certifica el SLO del futuro monitoreo en vivo.
Total sin contar repeticiones: 124 pruebas de contratos/integración/regresión y
3 E2E. Cero fallos finales y cero defectos críticos/altos conocidos del bloque.

## Procedimiento reproducible

Desde la raíz Ana Rutas, Node 24 y dependencias instaladas:

```powershell
npm run typecheck
npm run lint
npm run build
npx vitest run --config vitest.incident-organization.config.ts --coverage
npx vitest run tests/driver-financial-integration.test.ts
node scripts/verify-incident-organization-mutations.mjs
npx playwright test tests/e2e/product-incidents.spec.ts
npm audit --omit=dev
npm audit
git diff --check
```

La regresión adicional ejecuta los archivos de pruebas afectados por el avance
del esquema a 46. Esos cambios son expectativas de versión, además de incorporar
la nueva tabla al desmontaje de bases de prueba antiguas. No eliminan guardas.
Todas usan PostgreSQL 17 aislado en 127.0.0.1, fotos reales generadas, autenticación
y consultas reales; no API simulada ni acceso a producción/Odoo/Google/OpenAI.

Selección reproducible de la regresión adicional (PowerShell):

```powershell
$ioSuites = @(
  'customer-unloading', 'customer-windows-daily', 'driver-incidence-schema',
  'driver-mobile-phone-migration', 'driver-route-completion', 'driver-service-commands',
  'driver-service-schema', 'financial-store', 'fleet', 'google-consumption-persistence',
  'live-eta-integration', 'live-warehouse-integration', 'orders', 'plan-creation-migration',
  'recalculation', 'route-publication-revisions', 'route-publications',
  'unit-photo-retention', 'unloading-learning'
) | ForEach-Object { "tests/$_.test.ts" }
& node node_modules/vitest/vitest.mjs run @ioSuites
npx vitest run tests/product-incidents-excel.test.ts
```

Evidencia local: `.local/io-*.log`, `reports/coverage/incident-organization`,
`reports/mutation/incident-organization.json` y
`.local/qa/incident-organization/comment-live.png`. No se versionan bases ni secretos.

## Entrega por bloques

IO-T01 prepara API/datos. La APK, agrupación completa en vivo, devoluciones en
esa vista, Visto compartido, alarmas y el editor visual de comentarios siguen en
IO-T02/03. No presentar esta entrega parcial como la función completa ni sugerir
desplegarla para comprobar las pantallas finales. Se requiere primero backend
compatible y después APK nueva, siguiendo los bloques restantes.
No se ejecutaron migraciones remotas, no se creó APK, no se tocó main ni se desplegó.
