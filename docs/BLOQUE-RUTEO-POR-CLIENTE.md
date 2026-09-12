# Corrección: cliente indivisible al armar ruta

Solicitud del 11 septiembre 2026: dos pedidos Alta de Progreso Independencia y
tres Media de Fonda Martha fueron repartidos entre dos camionetas.

## Autopsia y alcance

`route-ai-planner.ts` enviaba IDs/coordenadas/prioridad/ventanas sin identidad de
cliente. `parseCandidate` verificaba cobertura y prioridad, no afinidad; el
evaluador contaba pedidos para exigir uso de flota. `applyOptimizationResult`
carecía de una última protección de agrupación.

BL-048: cada cliente/destino constituye un grupo indivisible, consecutivo y con
una sola camioneta en Armar ruta. Identidad: partnerId de entrega Odoo; la
instalación está vinculada a un único fingerprint mediante `bindOdooSource`.
No agrupar por nombre, comercial padre ni coordenadas: sucursales distintas
conservan su identidad. Cada surtido/venta conserva tarjeta, cantidades y estado.

BL-049: uso de flota y mínimo de alternativas se calculan por grupos elegibles,
no por pedidos. Si sólo hay un grupo no se divide para llenar camionetas.
Prioridades globales, ventanas, salida, regreso, calles y comparador no cambian.
Prioridades incompatibles no se relajan ni se inventan horarios/capacidades.

BL-050: validar agrupación antes de medir y antes de escribir dentro de la
transacción versionada. Devolver a las tools el error de grupo para que el LLM
replantee; ninguna heurística del backend decide el chofer. Snapshot de IA con
grupos opacos y miembros, sin nombres ni datos personales adicionales. La huella
incluye identidad del cliente. El recálculo de movimientos manuales no redistribuye.

## Escenarios y tareas verificables

| Escenario                                          | Resultado                                           | Tarea y validación          |
| -------------------------------------------------- | --------------------------------------------------- | --------------------------- |
| RC01: dos Alta y tres Media del mismo cliente      | un chofer por cliente, todas las tarjetas           | RC-T01 unidad/regresión     |
| RC02: A, B, A en una camioneta                     | rechazar visita fragmentada                         | RC-T01 unidad/mutación      |
| RC03: misma etiqueta/coordenadas, otro partner     | destinos distintos                                  | RC-T01 unidad               |
| RC04: un cliente, varios pedidos, dos camionetas   | una vacía permitida, una alternativa suficiente     | RC-T02 evaluación           |
| RC05: varias identidades suficientes para flota    | mantener balance, prioridad y ventanas              | RC-T02 regresión            |
| RC06: recogidas/archivados                         | fuera de grupos elegibles                           | RC-T01 unidad               |
| RC07: propuesta Google/IA separa un grupo          | rechazar, corregir por tools, nunca guardar parcial | RC-T02 contrato/smoke real  |
| RC08: guardado directo de grupo dividido o parcial | rollback, misma versión/pedidos/auditoría           | RC-T03 PostgreSQL           |
| RC09: versión/actor/identidad cambia               | conflicto o denegación, no sobrescribir             | RC-T03 PostgreSQL/regresión |
| RC10: grupo correcto                               | persistencia íntegra; manual conserva decisiones    | RC-T03 PostgreSQL/E2E       |

No migración, cambios Odoo, pesos, V3, Luna ni producción. Sin nuevas APIs
externas ni cambios de configuración. La propuesta Google existente sigue siendo
una semilla, no autoridad para el guardado.

Auditoría previa: GREEN LIGHT / INTEGRITY TOTAL. Correspondencia RC-T01..03 con
RC01..10: MATCH PERFECT documental. No equivale a puertas de ejecución verdes;
registrarlas en QA-RUTEO-POR-CLIENTE.md antes de declarar listo.
