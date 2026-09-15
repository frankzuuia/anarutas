# QA — control de costo de Fleet Routing

Fecha: 2026-09-14. Rama: `develop`. Alcance: FC01..FC07.

## Resultado

**VERDE local.** Una pulsación de `Armar ruta` realiza una solicitud Fleet
Routing global y, únicamente cuando existe una secuencia útil, una segunda para
el mejor reparto ya medido. No existe ningún camino activo que envíe una tercera
solicitud. Si la segunda falla, el mejor candidato local completo se guarda.

Mover, reordenar o cambiar un pedido de camioneta no llama Fleet Routing. La
decisión manual se guarda en PostgreSQL y el worker existente sólo recalcula
tramos y ETA con Google Routes, sin redistribuir pedidos.

No se ejecutó un smoke facturable ni se usaron credenciales live durante QA.

## Evidencia

| Puerta | Resultado |
| ------ | --------- |
| Integración dirigida | 7/7: dos solicitudes exactas, una cuando no aporta secuenciar, fallback no bloqueante, movimientos manuales y logs seguros |
| Suite completa | 37 archivos, **385/385** pruebas |
| Cobertura global | 94.05% statements, 87.12% branches, 97.69% functions, **95.29% lines** |
| Cobertura presupuesto Fleet | **100%** statements/functions/lines |
| Cobertura orquestador | 89.88% statements, 64.28% branches, 94.11% functions, **91.81% lines** |
| Mutation testing presupuesto Fleet | **100%**, 5/5 mutantes eliminados, 0 sobrevivientes |
| TypeScript / ESLint | Aprobados |
| Build Next.js 16.3.4 | Aprobado; 16/16 páginas generadas |
| E2E local | 1 aprobado; 2 live omitidos deliberadamente |
| Dependencias runtime | `npm audit --omit=dev`: **0 vulnerabilidades** |

Las pruebas de integración usan PostgreSQL efímero real y contratos HTTP
controlados para no facturar. Verifican el JSON íntegro de ambas solicitudes, el
contador de EasyPanel, el guardado atómico y que el fallback termina en
`routing.completed`.

## Observabilidad esperada tras deploy

En EasyPanel una ruta ordinaria debe mostrar:

1. `routing.google.started`: solicitud 1 de máximo 2.
2. `routing.local.preselection.started`: alternativas comparadas sin Fleet.
3. `routing.google.sequence.started`: solicitud 2 de máximo 2, sólo para el
   finalista; o `routing.google.sequence.not_required` si no aporta valor.
4. `routing.completed`: `fleetRoutingRequests` igual a 1 o 2,
   `fleetRoutingRequestLimit: 2` y `fleetRoutingShipmentUnits` acumulado.

`fleetRoutingShipmentUnits` es trazabilidad de destinos enviados por Ana Rutas;
Google Cloud Billing conserva la autoridad sobre unidades finalmente facturadas.

## QA posterior al deploy manual

1. Desplegar sólo `develop` en `ana-rutas-develop/app`.
2. Pulsar `Armar ruta` una vez en el lote de 61 pedidos.
3. Confirmar en EasyPanel exactamente dos eventos de inicio Fleet Routing y un
   `routing.completed` con límite 2.
4. Confirmar cobertura de pedidos, prioridades, ventanas, reparto y mapa.
5. Mover un pedido manualmente y comprobar que no aparece ningún nuevo evento
   `routing.google.started` ni `routing.google.sequence.started`; sólo cambia el
   acomodo elegido y se recalculan sus tramos/ETA.
