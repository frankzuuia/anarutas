# RC — QA del reparto y prioridad conjuntos

Bloque solicitado y aprobado por el propietario el 2026-10-04. Especificación:
[BLOQUE-RUTEO-CONJUNTO.md](BLOQUE-RUTEO-CONJUNTO.md). Política final
`google-zones-v7-joint-priority`. Base de revisión: develop
`51989f893f93ac1ad3e8c47681bd96c3dfc15cc8`.

## Autopsia y corrección

El modelo v6 agrupaba el punto con su prioridad máxima y cobraba un costo finito
por inversiones. Después se ordenaba cada camioneta sin permitir otro reparto.
La asignación se optimizaba sin representar la secuencia individual finalmente
exigida. Expert llegaba tarde a Zinclote en el plan v16 revisado.

Ahora cada punto/rango tiene su visita y su cierre/descarga. Los rangos distintos
del mismo punto tienen un propietario libremente elegido por Google mediante
`PERFORMED_BY_SAME_VEHICLE`. Las transiciones de media a alta, de horario a alta
y de horario a media no caben en ninguna ruta válida. Google decide conjuntamente
asignación y secuencia; se valida el recibo antes de guardar y se conserva íntegro.
No se impone reparto igual de prioridades ni se elimina la preferencia geográfica.

El primer ensayo nativo produjo el error real Google3009:
`TRANSITION_ATTRIBUTES_DELAY_DURATION_EXCEEDS_GLOBAL_DURATION`. No se consideró
exitoso ni se guardó remotamente. Se corrigió el sobre global para contener el
delay, conservando el horizonte original de cada vehículo como su duración máxima.
`VALIDATE_ONLY` final devolvió HTTP200, `{}`, sin errores. El cálculo posterior
normal pasó con una llamada Fleet y cero consultas Routes/reordenamientos.

## Procedencia y frontera de las pruebas reales

- Plan visible en Brave: prueba13, v16, 44 pedidos, tres camionetas. Revisión sin
  pulsar Armar, publicar, activar o cambiar clientes en el servicio remoto.
- Exportación del propietario: `ana-rutas-prueba-13-2026-10-02 (1).xlsx`, obtenida
  el 2026-10-04. Comparación de todos los folios, prioridades, coordenadas,
  ventanas y salida con la proyección utilizada: **44/44, cero diferencias**.
- Descargas: configuración de clientes de la captura previamente verificada,
  total540min. Este dato no viene en el Excel; no se afirma haber leído otra vez
  la base remota de clientes. Un intento de abrir su API en Brave fue bloqueado
  por el cliente y no se usó como evidencia de lectura.
- Odoo de desarrollo: lectura real de los 44 pedidos, sin escrituras. Si cambian
  o faltan, la prueba falla. PostgreSQL efímero, migraciones reales, clientes,
  plan, lease, snapshot y auditoría reales; Google externo real.
- Evidencia privada en
  `C:/Users/figod/AppData/Local/Temp/codex-route-joint-20261004`:
  `source-projection.json`, `input-projection.json`, `strict-google-request.json`,
  `strict-google-response.json`, `strict-result.json`, `strict-summary.json`,
  `native-validation.json` y `native-validated-request.json`. Prefijo `strict`
  reutiliza el contrato de replay anterior; el recibo registra la política v7.
- Credenciales sólo por entorno del proceso privado; nunca se commitean la
  proyección, las claves, tokens de ruta, clientes ni las respuestas completas.

## Resultado vial real

Salida08:00, America/Mexico_City. Los kilómetros incluyen el regreso a bodega.

| Camioneta | Pedidos v16 → v7 | Km v16 → v7     | Regreso v16 → v7 | Alta/media v7 |
| --------- | ---------------- | --------------- | ---------------- | ------------- |
| Expert    | 11 → 13          | 90.452 → 70.023 | 13:35 → 14:02:34 | 3/0           |
| ford2025  | 16 → 15          | 76.180 → 85.669 | 14:08 → 14:31:03 | 0/1           |
| Ford2026  | 17 → 16          | 61.386 → 65.127 | 14:50 → 14:44:33 | 0/0           |

- **44 pedidos**, 39 puntos físicos, 41 visitas Fleet; cero omitidos,
  duplicados, inversiones de prioridad o puntos propiedad de dos camionetas.
- Distancia total **228.018 → 220.819km**, reducción observada7.199km, 3.16%.
- Atrasos previstos: v16 mostraba uno; el recibo nuevo tiene **cero**.
  Zinclote11:00:25, cierre11:15; Tapatío11:22:40, cierre11:30.
- Sanborns, prioridad media, ahora va primero en ford2025; las tres altas siguen
  en Expert. No existe una regla que dé a cada camioneta una prioridad alta.
  ANUNCIOS sigue primero, tramo14.185km: su prioridad y ubicación permanecen
  reales, no se altera el cliente para disimular la distancia.
- Descarga540min, conducción37090s (10h18m10), espera0, duración acumulada69490s
  (**19h18m10**), último regreso14:44:33. V16 mostraba18h35 acumulados en el panel;
  no se afirma una reducción de toda duración. Son mediciones externas de
  cálculos distintos, no una comparación con tráfico idéntico controlado.
- `operationalSeconds=61363` es el score existente conducción + máximo recorrido,
  **no** la suma de duración de las tres rutas. No se presenta como tiempo total.
- Margen más ajustado: ABARROTES FRANCO10:29:55 frente a cierre10:30, **5s**;
  Xokol08:28:34 frente a08:30, **86s**. El resultado previsto cabe, pero no tiene
  holgura operativa en esos clientes. No se promete puntualidad frente a retrasos
  reales, ni ausencia absoluta de calles compartidas o cercanía entre choferes:
  la exclusividad aplica al punto exacto y las zonas son preferencias de costo.

## Puertas y evidencia

| Puerta                           | Evidencia                                                | Resultado                                                                |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Regresión roja                   | `.local/joint-model-red.json`                            | 2 fallos de aserción reproducidos antes de la corrección                 |
| Unidad final                     | `.local/joint-unit-final.json`                           | 59/59                                                                    |
| Contratos y PostgreSQL enfocados | `.local/joint-focused-final.json`                        | 263 pasan; 1 integración opt-in omitida, ejecutada separadamente         |
| Integración Odoo/Google/PG       | `.local/joint-live.json`                                 | 1/1, Fleet1, Routes0, ningún reordenamiento                              |
| HTTP/Chrome, desktop/móvil       | `tests/e2e/route-zone-time-live.spec.ts`, caso strict    | 1/1, 32.1s                                                               |
| Cobertura V8 de doce módulos     | `coverage/zone-time-focused/coverage-summary.json`       | líneas96.82%, ramas94.81%, funciones98.73%, sentencias96.63%             |
| Contrato crítico nuevo           | `route-fleet-constraints.ts`                             | 100% líneas, ramas, funciones y sentencias                               |
| Mutación por aserciones          | `reports/mutation/zone-time.json`                        | 70/70 detectadas, baseline161/161                                        |
| Typecheck                        | `npm run typecheck`                                      | 0 errores                                                                |
| Lint                             | `npm run lint`                                           | 0 errores; 1 advertencia previa en stryker.product-amendments.config.mjs |
| Build producción                 | `npm run build`                                          | verde, Next16.3.8                                                        |
| Supply chain producción          | `npm audit --omit=dev --json`                            | 0 vulnerabilidades                                                       |
| Regresión general consolidada    | `.local/joint-regression-consolidated.json`              | 1078 aprobadas, 4 opt-in; ningún caso pendiente                          |
| Seguridad de artefactos/diff     | `.local/joint-secret-scan.json` y revisión independiente | 6 valores privados buscados, 14 archivos frontend; cero coincidencias    |

Cobertura objetivo por riesgo: contrato nuevo crítico100%; conjunto afectado
≥95% líneas/sentencias/funciones y ≥90% ramas. Las ramas no cubiertas de adaptadores
previos se reportan, no se ocultan elevando el promedio. La mutación adicional
quita límites/guarda/propietario, invierte prioridades y admite recibos inválidos:
los fallos son aserciones, no errores de compilación considerados como detección.

ESLint midió todas las funciones/callbacks del módulo nuevo: complejidad máxima9.
Construcción del modelo y validación del recibo real, 20 calentamientos y100
muestras: p50 **43.88ms**, p95 **67.29ms**, máximo77.05ms. Google + guardado real:
**46.439s**. Son mediciones QA locales, no un SLO de producción garantizado.

El primer E2E expiró sin obtener evidencia suficiente durante una ejecución larga
del entorno. Se conserva como fallo, no se aprobó. La repetición con idéntico código
pasó en32.1s. El Chrome aislado carece intencionalmente de credenciales Maps del
frontend: comprueba recibo, kilómetros, avisos, filtros y viewport; las capturas
no certifican el dibujo Google Maps configurado en Brave del propietario.
La caída real de configuración del servidor devuelve503 y conserva el snapshot.

La primera regresión general tuvo dos fallos y un hook expirado; la repetición
de los tres archivos pasó22/22 sin cambios. La segunda corrida global produjo
1077 aprobadas y un único fallo de precondición en
`driver-financial-integration.test.ts`. La traza de PostgreSQL/Node reales
demostró que `last_success_at` quedaba **5ms por delante** del reloj de la llamada;
la guarda financiera de fecha futura respondió correctamente con
`FINANCIAL_SOURCE_STALE` antes de comprobar cantidad. No fue un defecto del
modelo de ruteo ni una fuente vencida por duración de esa prueba (102ms).

Se corrigió **sólo ese archivo de pruebas**: después de persistir consulta la
observación real y espera con una aserción a que Node la alcance. Conserva las
guardas financieras de producción y añade rechazo explícito de una fecha futura,
además de vencimiento/error. Sus cuatro casos pasaron; typecheck/lint/formato
posteriores verdes. El resultado1078 es evidencia **consolidada** de la corrida
global y esa repetición corregida, no una única corrida global ininterrumpida.
Los cuatro opt-in son Odoo financiero, miniaturas, FCM y el caso Google de este
bloque; este último sí se ejecutó separadamente con servicios reales. Los otros
tres están fuera del cambio y no se presentan como integraciones realizadas.

## Aceptación, fallos y recuperación

MATCH RC01..12 → `acceptance-joint-routing.feature` y pruebas:

- RC01..06: `route-fleet-constraints.test.ts`, `route-google-direct.test.ts`,
  ventanas/recepción/descarga y guardas. Flotas1/4/5/6/12, horizontes enteros y
  fraccionarios, límites existentes, idempotencia, punto mixto y prioridades
  independientes entre vehículos. DTOs puros no sustituyen un servicio externo.
- RC07..08: `route-strict-priority-live.test.ts`; integración real, lease ocupado,
  versión cambiada, settings modificados durante cálculo, sólo un snapshot,
  secuencia/medición fieles y liberación al terminar/fallar.
- RC09..10: Chrome/HTTP real, 401 anónimo, 403 liquidador/origen ajeno, filtro por
  camioneta, 44 pedidos persistidos, actualización que retira forecast obsoleto,
  sin errores JS. Sin interceptar APIs ni inyectar rutas inventadas.
- RC11: regresión general y contratos previos; ningún archivo Android,
  liquidación, publicación, operación del chofer u Odoo de producción modificado.
  La preparación temporal del test financiero se corrige por la causa medida;
  no se relajan ni suprimen sus aserciones o las guardas de negocio.
- RC12: ventanas/cierres y forecast tardío comprobados por contratos existentes;
  el caso externo nuevo no es tardío. No se fabrica un atraso externo para
  presentar una integración adicional como real.
- La suite histórica `route-ai-integration.test.ts` ya contiene transportes
  inyectados. Sólo se actualizaron contratos y aserciones de la nueva auditoría;
  no se añadieron mocks y no se considera esa suite evidencia Google real.

## Reproducción y entrega

1. Revisar instrucciones, develop y la proyección contrastada con la exportación.
   Ejecutar unitarias/enfocadas y mutación:
   `node node_modules/vitest/vitest.mjs run --config vitest.zone-time.config.ts --coverage`
   y `node scripts/verify-zone-time-mutations.mjs`.
2. Entorno privado con Odoo/Google de desarrollo y
   `RUTAS_QA_STRICT_PRIORITY_CAPTURE_DIRECTORY` apuntando a la captura verificada.
   Ejecutar `node node_modules/vitest/vitest.mjs run tests/route-strict-priority-live.test.ts`.
   Odoo se lee, PostgreSQL se crea aislado y Google recibe el modelo real.
3. Compilar y reproducir el recibo con
   `node node_modules/@playwright/test/cli.js test tests/e2e/route-zone-time-live.spec.ts -g "strict-priority receipt"`.
   Ejecutar regresión completa, typecheck, lint, build y audit producción.
4. Revisar diff/secretos, retirar credenciales temporales y subir únicamente el
   bloque a develop cuando todas las puertas terminen. El propietario despliega
   develop y vuelve a pulsar Armar ruta para obtener el recibo vigente del servicio.
   No se sustituye el borrador remoto ni se publica/inicia ninguna ruta como QA.
