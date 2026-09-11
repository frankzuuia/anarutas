# QA — bloque 5C: control de consumo oficial de Google

Evidencia local cerrada el 2026-09-11. Rama: `develop`.

## Resultado

La sección lateral `Control de consumo` está implementada sin modificar el mapa.
Su única autoridad es Cloud Billing Standard usage cost junto con Pricing data
exportados por Google a BigQuery. Ana Rutas no suma clics, pedidos ni llamadas
estimadas: sustituye una fotografía PostgreSQL con el último corte oficial.

La vista muestra costo bruto, créditos, neto, consumo por SKU, cuota sin cargo,
restante, porcentaje, siguiente escalón publicado e historial diario/mensual. Fuente,
proyecto y tiempos de exportación/precio permanecen visibles. Si falta configuración no
presenta `$0`; si Google falla conserva el último corte y lo marca atrasado.

El smoke vivo permanece pendiente porque las dos exportaciones y el IAM FinOps aún
deben habilitarse en Google Cloud. Ninguna prueba declara cifras reales de la cuenta del
usuario y ningún secreto fue utilizado o guardado.

## Evidencia reproducible

| Puerta                           | Comando                                                                                                | Resultado                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Tipos                            | `npm run typecheck`                                                                                    | PASS                                                                    |
| Estática                         | `npm run lint`                                                                                         | PASS                                                                    |
| Unidades e integración completa  | `npm run test:coverage`                                                                                | PASS — 29 archivos, 293/293 pruebas                                     |
| PostgreSQL/migraciones focales   | `npx vitest run tests/fleet.test.ts tests/orders.test.ts tests/google-consumption-persistence.test.ts` | PASS — 20/20; actualización v8 reentrante y sin pérdida                 |
| Cobertura global                 | `npm run test:coverage`                                                                                | PASS — 90.40% statements, 84.06% ramas, 96.55% funciones, 91.97% líneas |
| Mutación del cálculo FinOps      | `npm run test:mutation:google-consumption`                                                             | PASS — 258 mutantes; 93.80% total, 94.53% cubierto, 242 eliminados      |
| Supply chain                     | `npm audit --audit-level=high`                                                                         | PASS — 0 vulnerabilidades                                               |
| Build productivo                 | `npm run build`                                                                                        | PASS — Next.js 16.3.4 y API dinámica `/api/google-consumption`          |
| E2E autenticación/UI/regresiones | `npx playwright test tests/e2e/panel.spec.ts`                                                          | PASS — 1/1 recorrido integral; 20.3 s de prueba, 30.5 s total           |
| Diff                             | `git diff --check`                                                                                     | PASS — sin errores de whitespace                                        |

Los 14 mutantes supervivientes corresponden principalmente a validaciones redundantes
que terminan en el mismo rechazo público y expresiones equivalentes de orden/nulabilidad;
dos mutaciones no cubiertas pertenecen a una guarda ya respaldada por validación
anterior y a un sentinel de orden para porcentajes nulos. La
puerta queda configurada para fallar por debajo de 90%, por encima del riesgo justificado
para este cálculo. Los límites monetarios, signos de crédito y umbrales exactos
70/85/95/100 sí están cubiertos y eliminan sus mutantes.

## Matriz verificada

- La migración v8 crea una sola fila de estado, es reentrante y preserva cuentas,
  planes, flota, pedidos, clientes, optimizaciones y auditoría anteriores.
- La configuración ausente produce `unconfigured`; una envoltura parcial, identificador
  no permitido o límite fuera de rango falla cerrada.
- El JSON FinOps se decodifica sólo en servidor y es independiente de la cuenta usada
  para Route Optimization.
- BigQuery se consulta únicamente en `bigquery.googleapis.com`, sin redirects, con OAuth,
  consulta parametrizada por proyecto, cache del proveedor, respuesta acotada y
  `maximumBytesBilled`; uso y `export_time` acotan el periodo para habilitar poda de
  particiones.
- Se exige exactamente una tabla Standard y `cloud_pricing_export` en el dataset;
  resultados ambiguos, monedas mezcladas, números no finitos o esquema incompleto se
  rechazan.
- Los créditos conservan su signo oficial y el costo neto es bruto más créditos. No hay
  conversión de moneda local.
- El primer escalón con precio positivo determina la cuota sin cargo; no existen límites
  `10,000` o `1,000` codificados en producción.
- Dos sincronizaciones concurrentes producen una consulta externa; el lease expira y es
  recuperable. Una nueva fotografía reemplaza a la anterior y no duplica uso.
- El worker dedicado revisa vencimiento cada minuto y BigQuery sólo se consulta cuando
  `next_sync_at` vence. Por defecto el corte se renueva cada 30 minutos.
- GET y POST requieren sesión; POST además exige mismo origen y JSON. Auditoría sólo
  registra fuente, proyecto, periodo, cantidad de SKU y códigos sanitarios.
- La pantalla acompaña cada color con texto, ofrece progreso accesible, soporta móvil y
  muestra cero solamente cuando existe una fotografía oficial que realmente lo reporta.
- El mapa y el cálculo de rutas no importan ni llaman al módulo FinOps.

## Guardas y SLO técnicos

- Timeout HTTP Google: 35 segundos; respuesta máxima: 5 MiB; máximo 5,000 filas.
- Consulta predeterminada limitada a 100,000,000 bytes y tres meses; ambos límites
  relevantes son configurables sólo dentro de fronteras validadas.
- Lease: 2 minutos; reintento de fallo: máximo 15 minutos; refresco oficial por defecto:
  30 minutos.
- Estado anterior disponible durante una caída. No se garantiza tiempo real: la hora de
  `export_time` de Google siempre prevalece sobre la hora de sincronización de Ana Rutas.

## Smoke vivo pendiente en develop

1. Habilitar BigQuery API en el proyecto de consulta.
2. Crear un dataset dedicado y activar Standard usage cost + Pricing data export desde
   la cuenta de facturación asociada al proyecto Maps de develop.
3. Crear una cuenta de servicio FinOps separada; otorgar `BigQuery Job User` en el
   proyecto de consulta y `BigQuery Data Viewer` únicamente en el dataset.
4. Codificar su JSON en base64 y guardarlo como secreto privado de EasyPanel junto con
   proyecto, dataset y ubicación. No usar `NEXT_PUBLIC` ni pegar la clave en el chat.
5. Reiniciar develop, abrir `Control de consumo` y pulsar `Sincronizar ahora` una vez.
6. Comparar proyecto, SKU, uso, costos y `Último corte de Google` con la consola Cloud
   Billing para el mismo periodo. Probar después un permiso retirado y confirmar que el
   último corte permanece visible como atrasado.

## Reversión

Revertir el código en `develop` y reconstruir. La tabla v8 es aditiva: no eliminarla al
retroceder porque conserva observabilidad. Retirar las variables FinOps desactiva el
worker sin afectar mapas, rutas u Odoo. La desactivación de los exports en Google es una
operación externa separada y no se realiza automáticamente.
