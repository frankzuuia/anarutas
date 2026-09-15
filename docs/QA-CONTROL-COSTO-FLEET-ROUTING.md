# QA — control de costo de Fleet Routing

Fecha: 2026-09-14. Rama: `develop`. Alcance: FC08..FC14.

## Resultado

**VERDE local para FC08..FC14.** Una pulsación de `Armar ruta` construye
y mide primero una solución local completa, la inyecta como warm start en una
única solicitud Fleet Routing y compara la respuesta sin permitir una segunda
salida de red. Si Google falla, omite o devuelve un contrato inválido, el mejor
candidato local completo se guarda.

Mover, reordenar o cambiar un pedido de camioneta no llama Fleet Routing. La
decisión manual se guarda en PostgreSQL y el worker existente sólo recalcula
tramos y ETA con Google Routes, sin redistribuir pedidos.

No se ejecutó un smoke facturable ni se usaron credenciales live durante QA.

## Evidencia

| Puerta                              | Resultado                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Integración PostgreSQL real         | **2/2**: warm start y única llamada; 503 conserva ruta local completa                                               |
| Contrato/política dirigidos         | **98/98** pruebas                                                                                                  |
| Suite completa                      | 37 archivos, **385/385** pruebas                                                                                   |
| Cobertura global                    | 94.13% statements, 87.24% branches, 97.52% functions, **95.43% lines**                                             |
| Cobertura contrato Google           | 97.73% statements, **95.94% branches**, 97.72% functions, **97.58% lines**                                         |
| Cobertura orquestador               | 90.72% statements, 64.28% branches, 89.65% functions, **93.70% lines**                                             |
| Mutation testing presupuesto Fleet  | **100%**, 5/5 mutantes eliminados, 0 sobrevivientes                                                                |
| Mutation testing logístico          | **97.67% total / 97.87% cubierto**; 895 killed, 26 timeout, 20 survived, 2 sin cobertura                            |
| TypeScript / ESLint                 | Aprobados                                                                                                          |
| Build Next.js 16.3.4                | Aprobado; 16/16 páginas generadas                                                                                  |
| E2E local aislado                   | **1 aprobado / 2 live omitidos** deliberadamente; una corrida paralela inválida se repitió aislada y quedó verde   |
| Dependencias runtime                | `npm audit --omit=dev`: **0 vulnerabilidades**                                                                     |
| Diff/secretos                       | `git diff --check` verde; `ana-rutas-develop-07d4df8488a5.json` permanece local, sin seguimiento ni staging        |

Las pruebas de integración usan PostgreSQL efímero real y contratos HTTP
controlados para no facturar. Verifican el JSON íntegro de la única solicitud, el
warm start, el contador de EasyPanel, el guardado atómico y que el fallback termina en
`routing.completed`.

## Observabilidad esperada tras deploy

En EasyPanel una ruta ordinaria debe mostrar:

1. `routing.local.preselection.started`: alternativas comparadas sin Fleet.
2. `routing.google.started`: única solicitud, con límite 1 y warm start medido.
3. `routing.google.completed` o `routing.google.unavailable`: propuesta completa
   medida o conservación del candidato local sin reintento.
4. `routing.completed`: `fleetRoutingRequests` igual a 0 o 1,
   `fleetRoutingRequestLimit: 1` y `fleetRoutingShipmentUnits` del lote enviado.

`fleetRoutingShipmentUnits` es trazabilidad de destinos enviados por Ana Rutas;
Google Cloud Billing conserva la autoridad sobre unidades finalmente facturadas.

## QA posterior al deploy manual

1. Desplegar sólo `develop` en `ana-rutas-develop/app`.
2. Pulsar `Armar ruta` una vez en el lote de 61 pedidos.
3. Confirmar en EasyPanel exactamente un evento `routing.google.started` y un
   `routing.completed` con límite 1.
4. Confirmar cobertura de pedidos, prioridades, ventanas, reparto y mapa.
5. Mover un pedido manualmente y comprobar que no aparece ningún nuevo evento
   `routing.google.started` ni `routing.google.sequence.started`; sólo cambia el
   acomodo elegido y se recalculan sus tramos/ETA.
