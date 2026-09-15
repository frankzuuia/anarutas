# Bloque — refinamiento global entre camionetas

> Estado: **sustituido por FC01..FC07 el 2026-09-14**. Este archivo conserva la
> autopsia histórica, pero el refinamiento Fleet adicional dejó de formar parte
> del flujo activo porque amplificaba hasta seis solicitudes por armado. El
> contrato vigente está en `BLOQUE-CONTROL-COSTO-FLEET-ROUTING.md`.

Fecha: 2026-09-14. Alcance exclusivo: Ana Rutas `develop`.

## Autopsia

La corrida live posterior a BL-078..082 redujo la distancia de 397.9 km a
311.2 km y conservó 60 pedidos, cuatro camionetas, prioridades y puntos físicos.
El mejor candidato, sin embargo, dejó 142.2 km en una unidad frente a 30.9 km
en otra. La selección final no falló: eligió correctamente el menor score entre
doce alternativas medidas. El hueco está antes del comparador: las semillas
locales intercambian puntos usando carga y dispersión, mientras la optimización
vial posterior mantiene cada reparto fijo. Ninguna etapa vuelve a abrir
globalmente el reparto partiendo de la mejor ruta vial ya conocida.

Veredicto previo: **RED ALERT** por ausencia de refinamiento inter-ruta sobre el
ganador medido. Este contrato obtiene **GREEN LIGHT / MATCH PERFECT** porque
preserva como línea base la ruta vigente, utiliza el warm start oficial de
Google, revalida cobertura/puntos/prioridad y sólo acepta una mejora según el
score exacto existente.

## Reglas de negocio

| ID     | Regla                                                                                                                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BL-083 | Después de medir las semillas vigentes, Ana Rutas conserva intacto su ganador preliminar y lo transforma por grupos de entrega en una solución inicial completa para `injectedFirstSolutionRoutes`. Google recibe nuevamente el reparto abierto, sin fijar camionetas, y busca una mejora global durante todo el tiempo dinámico del lote.        |
| BL-084 | El resultado refinado nunca se guarda directamente. Primero debe conservar cobertura exacta y puntos físicos indivisibles; después Google vuelve a secuenciar su reparto con camionetas fijas y precedencias Alta → Media → Por horario, y Google Routes vuelve a medir ETA, espera, tardanza, regreso, distancia y polilíneas.                   |
| BL-085 | La ruta preliminar permanece elegible hasta el final. Un reparto refinado repetido, incompleto, inválido, con omisiones, no medible o peor se descarta; no bloquea ni reemplaza la última ruta válida. Sólo gana una alternativa estrictamente mejor mediante el mismo comparador logístico completo.                                             |
| BL-086 | Existe un refinamiento global por armado porque sólo hay un mejor candidato preliminar. No es un límite de pedidos ni de alternativas: el lote completo entra, el timeout nace de su tamaño y Google ejecuta búsqueda sucesiva con `CONSUME_ALL_AVAILABLE_TIME`. EasyPanel informa inicio, resultado y descarte sin PII, coordenadas ni secretos. |

## Escenarios

| ID   | Precondición                                                                   | Disparador          | Resultado                                                                                         | Recuperación                                         |
| ---- | ------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| IR01 | Existe un ganador preliminar completo                                          | Refinar globalmente | Google recibe todas las paradas agrupadas, camionetas y tiempos del ganador como solución inicial | La línea base no se modifica                         |
| IR02 | Google encuentra un reparto vial mejor                                         | Comparar            | El reparto se reordena con precedencias, se mide con Routes y gana sólo por score exacto          | Si una métrica anterior empeora, gana la base        |
| IR03 | El refinamiento cambia una parada de camioneta                                 | Secuenciar          | La asignación nueva queda fija y cada ruta cumple Alta → Media → Por horario                      | Una inversión de prioridad descarta esa secuencia    |
| IR04 | Dos clientes comparten coordenada confirmada                                   | Refinar             | Ambos conservan identidad y pedidos, pero quedan en la misma camioneta                            | Nunca se divide la parada física                     |
| IR05 | Google rechaza, omite o devuelve contrato inválido en el refinamiento opcional | Continuar           | Ana Rutas registra el descarte y elige entre candidatos preliminares ya medidos                   | No hay error ni guardado parcial por el refinamiento |
| IR06 | El lote supera 100 pedidos                                                     | Refinar             | Todo el lote entra al mismo flujo y el timeout crece por tamaño                                   | Ningún contador local recorta pedidos                |
| IR07 | Google devuelve el mismo reparto                                               | Deduplicar          | No se repite secuenciación ni medición                                                            | Se conserva la firma ya evaluada                     |
| IR08 | El plan cambia durante llamadas externas                                       | Guardar             | La transacción versionada rechaza el cambio obsoleto                                              | El borrador concurrente permanece intacto            |

## Flujo técnico

```text
semillas BL-078..082
  -> secuencia Google con asignación fija y precedencias
  -> medición Google Routes
  -> ganador preliminar exacto (línea base inmutable)
  -> OptimizeTours global con injectedFirstSolutionRoutes
  -> cobertura + reparación de punto físico + deduplicación
  -> secuencia Google con asignación refinada fija y precedencias
  -> medición Google Routes
  -> comparación final exacta contra la línea base
  -> transacción versionada existente
```

## Referencias oficiales

- https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/projects/optimizeTours
- https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentRoute
- https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows
- https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes

`injectedFirstSolutionRoutes` guía la primera solución y permite que Google
encuentre soluciones sucesivas distintas. La ruta inyectada debe usar índices
válidos, no duplicar vehículos o envíos y conservar tiempos no decrecientes.

## Puertas de salida

1. Unitarias del constructor warm start, agrupación, tiempos y validaciones.
2. Regresiones: ruta base gana, refinamiento gana, repetido se deduplica y fallo
   opcional conserva la base.
3. Integración PostgreSQL real con contratos Google inspeccionados y guardado
   único, sin OpenAI.
4. Gherkin IR01..08, cobertura y mutación del núcleo modificado.
5. Typecheck, lint, build, auditoría de dependencias y E2E del panel.
6. Smoke facturable sólo después del deploy manual en `develop`.
