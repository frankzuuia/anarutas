# QA — parada física y objetivo operativo

## Autopsia reproducida

En el borrador develop `Prueba 2` se observaron 60 entregas en cuatro camionetas.
Hotel Moto y Vincent Chapalita tenían exactamente la misma coordenada, pero Google
los asignó a unidades distintas; Vincent quedó 32 minutos tarde. Abarrotes Franco
tenía dos clientes en la misma coordenada y una camioneta abandonaba el punto para
regresar seis kilómetros después. El score v6 comparaba jornada, desequilibrio y
espera antes que viaje y distancia, por lo que podía premiar una ruta visualmente
pareja aunque recorriera calles innecesarias.

## Contrato corregido

- Política histórica certificada `priority-geographic-sequenced-v7`; el bloque
  posterior de búsqueda global la sustituye por
  `priority-geographic-sequenced-v8` sin retirar estas invariantes.
- Cada coordenada confirmada es una unidad indivisible de asignación. Los clientes
  conservan identidad, `partnerId`, pedidos, tarjetas y números de parada.
- Una propuesta Google que divide el punto se consolida donde ya está la mayoría
  de sus pedidos; el empate usa la camioneta menos cargada y después orden estable.
- La línea base geográfica particiona puntos físicos completos, no nombres.
- Una visita se compacta entre prioridades sólo si el resultado conserva cero
  inversiones Alta → Media → Por horario. Si no, se compacta únicamente dentro
  de cada nivel.
- Después de prioridad, retrasos y uso de flota, se minimiza
  `conducción total + jornada máxima`; viaje y distancia se evalúan antes que
  desequilibrio, espera y carga bruta.
- Ningún horario omite pedidos y no existe máximo propio de 100 o 500 entregas.

## QA manual posterior al deploy

1. Desplegar exclusivamente `develop` en `ana-rutas-develop/app`.
2. Volver a pulsar **Armar ruta** en `Prueba 2`.
3. Confirmar 60 entregas ruteadas y Sanborns fuera únicamente por modalidad Recoge.
4. Confirmar que Hotel Moto/Vincent Chapalita comparten una camioneta y una visita
   física, y que Abarrotes Franco no produce una salida y regreso evitable.
5. Comparar contra v32: 419.7 km, 22 h 18 min acumuladas, retornos 13:18–14:04 y
   un destino tarde por 1,882 segundos. La nueva corrida debe registrar sus propias
   métricas; no se promete una cifra inventada antes de consultar Google.
6. Revisar EasyPanel: `routing.colocation.assignment_repaired`, candidatos medidos,
   score v7, cobertura completa, pedidos por camioneta y guardado transaccional.

## Evidencia local ejecutada

| Puerta                       | Resultado                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Pruebas logísticas dirigidas | 5 archivos, 86/86 aprobadas                                                        |
| Suite completa con cobertura | 36 archivos, 367/367 aprobadas                                                     |
| Cobertura global             | 93.33% statements, 86.70% ramas, 97.27% funciones, 94.62% líneas                   |
| Planificador geográfico      | 99.39% statements, 96.66% ramas, 100% funciones y líneas                           |
| Mutación logística           | 98.32%; 637 eliminados, 7 timeouts, 11 sobrevivientes, 0 sin cobertura y 0 errores |
| Núcleo de score/evaluación   | 100% mutación en `route-logistics-policy` y `route-candidate-evaluator`            |
| Mutación de observabilidad   | 23/23 eliminados, 100%, sin sobrevivientes, cobertura faltante ni errores          |
| TypeScript / ESLint / diff   | Aprobados sin errores                                                              |
| Build Next.js 16.3.4         | Aprobado                                                                           |
| E2E local del panel          | 1/1 aprobado en navegador real                                                     |
| Dependencias de runtime      | `npm audit --omit=dev`: 0 vulnerabilidades                                         |

Objetivo por riesgo: umbral de mutación 95%; la corrida obtuvo 98.32%. Los
sobrevivientes restantes pertenecen a desempates geométricos equivalentes o ya
existentes y no cambian las invariantes de punto físico, prioridad, cobertura ni
score operativo. La integración local usa PostgreSQL real; las respuestas del
proveedor están inyectadas por contrato y no acreditan todavía una nueva corrida
facturable con Google.

## Alcance

No hay migración ni escritura Odoo. No se modifican producción, `main`, Ana V3,
Luna ni listas de precios. ETA todavía excluye tiempo de descarga porque no existe
una duración real configurada; no se inventó una constante.
