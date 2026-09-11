# Bloque 5C — control de consumo oficial de Google

## Decisión aprobada

El panel incorpora una sección lateral `Control de consumo`. No se añade información
de consumo al mapa. Las cifras confirmadas proceden exclusivamente de los exports
oficiales de Cloud Billing en BigQuery; PostgreSQL sólo conserva una caché sustituible
del último resultado y nunca incrementa contadores de Google.

La exportación estándar aporta uso, SKU, costo, créditos, moneda, proyecto y hora de
exportación. La exportación de precios aporta los escalones vigentes por SKU, incluida
la frontera en la que termina un nivel gratuito. Por ello los límites no se codifican
como constantes `10,000` o `1,000`: se derivan de los `tiered_rates` publicados para
la cuenta de facturación.

## Reglas de negocio

| Regla                 | Actor / negocio                                                       | Dirección técnica / datos                                                                                            | Permiso y auditoría                                         | Validación                                                                                                      |
| --------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| BL-037 Fuente oficial | Administrador consulta uso y costo confirmado                         | Cloud Billing Standard + Pricing export; filtro por `project.id` de Maps y SKUs cuyo `business_entity_name` sea Maps | Cuenta FinOps sólo servidor; lectura autenticada            | Sin export/configuración se muestra estado no configurado, nunca cero inventado                                 |
| BL-038 Acumulación    | Administrador necesita saber cuánto resta antes del siguiente escalón | Suma por `usage_start_time`, SKU y ciclo mensual de Google; costo bruto + créditos = neto                            | La caché no es autoridad y conserva `export_time`           | Reintentos y correcciones recalculan y sustituyen; no acumulan dos veces                                        |
| BL-039 Actualización  | El panel debe reflejar lo último que Google haya publicado            | Sincronización durable periódica y actualización manual; consulta con caché y límite de bytes                        | Evento de solicitud/éxito sin secretos ni consulta completa | Una sola sincronización concurrente; resultado anterior sigue visible ante fallo y queda marcado desactualizado |
| BL-040 Presentación   | El administrador compara cuotas independientes y costo real           | Medidor global de costo, historial y tarjeta por SKU con uso, escalón, porcentaje y restante                         | Sesión activa; ningún secreto en navegador                  | Moneda, fuente y hora visibles; color acompañado por texto; responsive y sin cambios al mapa                    |

## Matriz de escenarios

| ID  | Precondición / disparador                                    | Resultado esperado                                                        | Fallo / recuperación                                             | Evidencia                      |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| G01 | Variables FinOps ausentes                                    | Pantalla explica qué falta y no muestra cifras                            | Configurar EasyPanel y refrescar                                 | Unidad, E2E                    |
| G02 | Variables parcialmente presentes o identificadores inválidos | Falla cerrada con `GOOGLE_CONSUMPTION_CONFIG_INVALID`                     | Corregir runtime; ningún secreto se registra                     | Unidad, seguridad              |
| G03 | Export estándar y de precios disponibles                     | Se agrupa únicamente el proyecto Maps configurado y SKUs Maps             | Otro proyecto/cuenta no aparece                                  | Contrato BigQuery, integración |
| G04 | Dos instancias o usuarios sincronizan a la vez               | Un lease durable permite una sola consulta; ambos leen la misma caché     | Lease expirado puede recuperarse                                 | PostgreSQL concurrente         |
| G05 | Google agrega uso tardío o una corrección                    | La siguiente suma oficial reemplaza el snapshot                           | No hay doble conteo local                                        | Parser, PostgreSQL             |
| G06 | BigQuery aún no publica una acción reciente                  | Se muestra `Último dato de Google` sin fabricar pendiente como confirmado | La siguiente sincronización la incorpora                         | E2E                            |
| G07 | Google devuelve costo, créditos y moneda                     | Se muestra costo bruto, créditos y neto sin convertir localmente          | Monedas mezcladas o datos inválidos se rechazan                  | Unidad, contrato               |
| G08 | Pricing cambia un escalón gratuito                           | La siguiente sincronización deriva el nuevo límite y porcentaje           | SKU sin escalón gratuito se marca `Sin cuota gratuita publicada` | Unidad, mutación               |
| G09 | OAuth, IAM, BigQuery, cuota o red fallan                     | Error sanitario; conserva último snapshot y marca desactualizado          | Reintento periódico/manual con backoff                           | Unidad, integración            |
| G10 | Usuario abre rutas o mapa                                    | No aparece tarjeta de consumo ni se consulta Billing desde el navegador   | Sólo la sección lateral consume el API interno                   | E2E/regresión visual           |

## Flujo técnico

```text
Cloud Billing Standard export ─┐
                               ├─ BigQuery jobs.query ─ validación estricta
Cloud Billing Pricing export ──┘                         │
                                                         ▼
                                             snapshot oficial sustituible
                                                         │
                                   PostgreSQL cache + lease + auditoría
                                                         │
                                          /api/google-consumption
                                                         │
                                    sección Control de consumo únicamente
```

1. La cuenta FinOps obtiene OAuth con alcance `cloud-platform` sólo en servidor.
2. El servidor descubre exactamente una tabla estándar por prefijo oficial y exige
   `cloud_pricing_export` en el dataset configurado.
3. Una consulta GoogleSQL parametrizada filtra `project.id`; los identificadores de
   proyecto/dataset/tabla se validan antes de interpolarse porque BigQuery no permite
   parametrizar nombres de tabla.
4. El query une uso con los SKU Maps del export de precios, agrupa por día y conserva
   costo, créditos, moneda y `MAX(export_time)`.
5. El primer escalón con precio positivo determina la frontera gratuita vigente.
6. El parser acepta únicamente el esquema escalar esperado, limita filas/respuesta y
   rechaza números no finitos, monedas incoherentes o resultados incompletos.
7. La aplicación guarda el snapshot completo en una fila singleton. Volver a ejecutar
   la sincronización reemplaza esa fila, nunca suma sobre el valor anterior.

## Configuración y permisos

Variables runtime nuevas:

- `RUTAS_GOOGLE_FINOPS_SERVICE_ACCOUNT_JSON_BASE64`
- `RUTAS_GOOGLE_BILLING_EXPORT_PROJECT_ID`
- `RUTAS_GOOGLE_BILLING_EXPORT_DATASET_ID`
- `RUTAS_GOOGLE_BILLING_EXPORT_LOCATION`
- `RUTAS_GOOGLE_CONSUMPTION_SYNC_MINUTES` (opcional)
- `RUTAS_GOOGLE_BIGQUERY_MAX_BYTES_BILLED` (opcional, guardia de costo)

La cuenta FinOps requiere `roles/bigquery.jobUser` en el proyecto que ejecuta el query
y `roles/bigquery.dataViewer` exclusivamente sobre el dataset exportado. No se amplían
los permisos de la cuenta que optimiza rutas. El dataset debe contener Standard usage
cost y Pricing data export de la misma cuenta de facturación.

## Persistencia y API

- Migración aditiva v8: `route_google_consumption_state`, singleton con estado, lease,
  timestamps, error sanitario y snapshot JSON validado. No referencia ni modifica
  planes, pedidos, clientes, flota u Odoo.
- `GET /api/google-consumption`: estado configurado, snapshot y frescura; autenticado,
  privado y sin secretos.
- `POST /api/google-consumption`: solicita sincronización inmediata con Origin y JSON,
  adquiere lease y devuelve el snapshot oficial o error sanitario.
- El worker dedicado revisa vencimiento sin consultas si la integración no está
  configurada; el intervalo real se persiste para ser seguro con varias réplicas.

## UI aprobada

- Nueva entrada lateral `Control de consumo` después de Auditoría.
- Encabezado, actualización manual y fuente/fecha visibles.
- Costo confirmado: bruto, créditos y neto en la moneda retornada por Google.
- Historial diario/mensual accesible, sin dependencia de una librería de gráficas nueva.
- Una tarjeta por SKU realmente usado; uso, límite gratuito, restante, porcentaje y
  siguiente precio publicados por Google.
- Estados semánticos: dentro de cuota, atención, cerca del cobro, cobrando, sin pricing
  y desactualizado. El texto siempre acompaña al color.
- No se modifica `route-map-dialog.tsx` ni la experiencia de mapa.

## Seguridad, costo y calidad

- Host externo fijo `bigquery.googleapis.com`; redirects bloqueados; OAuth y secreto
  sólo servidor; respuesta acotada; SQL parametrizado; identificadores allowlist.
- Query cache activo, rango máximo de tres meses y `maximumBytesBilled` configurable.
- Ninguna lectura de Billing se ejecuta desde React ni expone billing account, dataset,
  correo de servicio, token o SQL.
- Pruebas unitarias de configuración/query/parser/agregación; PostgreSQL real para lease,
  sustitución y recuperación; contrato HTTP; Gherkin; E2E; cobertura y mutación del
  cálculo crítico; lint, typecheck y build.
- El smoke real exige exports e IAM configurados. Hasta entonces el producto debe mostrar
  `No configurado`, nunca declarar conexión ni métricas verdes.

## Referencias oficiales

- Standard usage export: https://cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage
- Pricing export: https://cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/pricing-data
- BigQuery `jobs.query`: https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
- IAM BigQuery: https://cloud.google.com/bigquery/docs/access-control
- Route Optimization billing: https://developers.google.com/maps/documentation/route-optimization/usage-and-billing

## Auditoría previa

GREEN LIGHT: la fuente confirmada es Google, el cache no contabiliza, los límites se
derivan de pricing, la consulta está aislada por proyecto y la UI no invade el mapa.

INTEGRITY TOTAL: la migración v8 es aditiva, la cuenta FinOps queda separada de ruteo,
no hay escritura Odoo ni cambios a asignación, optimización, clientes o APK futura.

MATCH PERFECT: BL-037..040 y G01..G10 se corresponden con G-T01..G-T07 de PROGRESS.
