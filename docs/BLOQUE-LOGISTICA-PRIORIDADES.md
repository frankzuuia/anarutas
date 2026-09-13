# Logística: prioridad, horarios y comparación medida

Solicitud 12/09/2026. Alcance: motor de Ana Rutas develop.

> Estado histórico: conserva la autopsia que originó el cambio. La participación
> de IA descrita aquí quedó sustituida por BL-065..068 y
> `BLOQUE-RUTEO-DETERMINISTA.md`; no forma parte del flujo vigente de Armar ruta.

## Autopsia

Google recibía puntos sin horarios ni grupos. El evaluador comparaba prioridades
por ETA entre toda la flota: permitía inversiones con ETA iguales y penalizaba
choferes independientes. La IA podía confirmar una sola propuesta conflictiva y
recibía métricas resumidas sin ETA/retraso por parada. La persistencia descartaba
los avisos calculados. En panel develop se comprobó ABARROTES FRANCO (Alta) noveno
y Santo Coyote (Media) sexto. Sanborns está configurado como Recoge: no cambiarlo.

Segunda autopsia live, 12/09/2026, plan de 61 pedidos/4 camionetas: el resultado
visible fue 33/20/5/2 (60 entregas; Sanborns en Recoge). EasyPanel acreditó sólo
5 candidatos, cero omisiones, retrasos 2→0, espera 274→256 s y jornada máxima
sin mejora: 23,492→23,492 s. La causa está en el contrato: ordenaba al modelo
«equilibra jornada real, no número bruto de pedidos», el score no contenía carga
por unidad y la comparación aceptaba cualquier reparto distinto. Por ello una
camioneta con 2 pedidos y otra con 33 podía confirmarse como mejor del conjunto.

## Reglas

BL-058: administrador arma ruta -> Alta, Media, Por horario por camioneta. El
servidor normaliza la precedencia ANTES de medir, preserva la secuencia propuesta
dentro de cada nivel y comunica la corrección a la IA. Grupo indivisible por
destino usa su máxima prioridad; no hay barreras de tiempo entre choferes.

BL-059: horarios -> Google recibe un envío por destino y envolvente con cierre
flexible. Ventanas múltiples se verifican exactamente en evaluación. Semilla con
costos relativos de tiempo; ganador lexicográfico vigente por BL-064: prioridad,
uso de flota, carga máxima/dispersión de pedidos y destinos, atrasos, fin de
jornada, desequilibrio temporal, espera, viaje y km.
No pesos de mercancía, capacidades ni tiempos de descarga inventados.

BL-060: IA -> tools nativas, todos los IDs, ETA/espera/atraso por parada y duración
por camioneta. Compara una alternativa sustantiva antes de confirmar si existen
alternativas; no añade tope de pedidos. Permutar nombres de camionetas no cuenta.
Puede seguir mejorando con evidencia; no se afirma óptimo global matemático.

BL-061: calles/persistencia -> caché efímera por corrida para tramos idénticos con
misma salida y modalidad de tráfico; fallos se descartan para poder reintentar.
Camionetas medidas en paralelo, paradas en secuencia; se espera su conclusión
antes de propagar un error. Guarda avisos
y versión de política con el orden final. Arrastre manual conserva acomodo del
operador y comparte diagnóstico por recorrido.

BL-062: no basta ordenar prioridades. Comparación comprobable de ASIGNACIÓN
(clientes a camionetas) y SECUENCIA (mismo reparto, otro recorrido dentro del
nivel), contra el mejor candidato medido. Sólo se exige cada dimensión cuando
es posible en ese candidato. Si un candidato nuevo mejora el resultado, las
comparaciones se reevalúan alrededor del nuevo mejor. Es evidencia de búsqueda,
no prueba de óptimo global. Cambiar nombres de camionetas no cumple ninguna.
La IA recibe holgura al cierre, llegada antes de espera, destinos por camioneta,
tiempo ocioso frente al regreso de la última camioneta y score del mejor medido.
El log final compara retrasos, esperas y duración de jornada con la semilla.

BL-064: balance de carga verificable -> si hay al menos tantos destinos como
camionetas, toda unidad debe entrar en la comparación. El score minimiza primero
el máximo y dispersión de pedidos, después el máximo y dispersión de destinos;
ventanas, jornada y calles deciden entre cargas comparables. Los conteos se
derivan del lote y la flota actuales: no son capacidad, tope de pedidos, peso ni
minutos de descarga. Los pedidos del mismo destino siguen indivisibles. Antes de
confirmar, el servidor construye y mide una línea base balanceada por grupos
completos (mayores primero a la unidad menos cargada) aunque la IA no la solicite;
la IA recibe el reparto por unidad y puede mejorarlo con calles/horarios reales.

Actor BL-058..061: administrador activo, Origin y versión existentes. Lee snapshot,
preferencias, flota y settings de Ana Rutas. Escribe run/paradas/plan y auditoría
`plan.optimized` en transacción existente; nunca Odoo. Logs sin PII ni secretos.

## Escenarios y correspondencia

| ID   | Precondición / disparador                        | Resultado y validación                                                                        | Tarea     |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------- |
| LP01 | Alta debajo, incluso con ETA igual               | Normalización previa, todos los IDs, unidad pura                                              | LP-T01    |
| LP02 | Varios pedidos de un destino                     | Juntos, máxima prioridad; sucursales distintas conservadas                                    | LP-T01/02 |
| LP03 | Alta abre tarde, dos camionetas                  | Sin barrera global; diagnóstico por recorrido                                                 | LP-T01    |
| LP04 | Sin horario, varias ventanas, salida posterior   | Semilla flexible, medición exacta, atraso visible                                             | LP-T02/03 |
| LP05 | Commit sin comparar / permuta de carriles        | Feedback recuperable; no guarda todavía ni omite pedidos                                      | LP-T03    |
| LP06 | Un destino o único orden permitido               | No exige comparación imposible                                                                | LP-T03    |
| LP07 | Atraso inevitable                                | Guarda entregas completas con avisos; sin límite añadido                                      | LP-T03/04 |
| LP08 | Mismo tramo y salida                             | Reutiliza lectura; fallo no queda cacheado                                                    | LP-T04    |
| LP09 | Concurrencia, permiso, quota/caída               | Cero escritura parcial; defensa existente y log sanitario                                     | LP-T03/04 |
| LP10 | Arrastre manual altera prioridad                 | Conserva orden y calcula conflicto por recorrido                                              | LP-T01/04 |
| LP11 | Pickup/archivado en lote                         | Modalidad respetada y conteos explícitos en log                                               | LP-T03    |
| LP12 | Guardado/relectura/mapa                          | ETA, avisos y geometría corresponden al orden medido                                          | LP-T04    |
| LP13 | Mismas prioridades pero malos horarios/reparto   | Gana menor retraso medido, no un orden cosmético                                              | LP-T06    |
| LP14 | Alternativas de reparto y secuencia              | Evidencia independiente alrededor del mejor; feedback recuperable                             | LP-T06    |
| LP15 | Mejor candidato cambia / no hay permutación útil | Recalcula evidencia; no exige una secuencia imposible                                         | LP-T06    |
| LP16 | Salida 23:59, todos los cierres vencidos         | Todos los pedidos completos y confirmables con atrasos                                        | LP-T06    |
| LP17 | 60 pedidos, 4 camionetas, propuesta 33/20/5/2    | Se mide línea base dinámica; 33/20/5/2 no gana frente a 15/15/15/15 si los grupos lo permiten | LP-T08    |
| LP18 | Pedidos repetidos del mismo destino              | Grupo no se divide; balance minimiza la mejor distribución alcanzable                         | LP-T08    |
| LP19 | Reparto balanceado con peores calles/horarios    | Entre cargas comparables ganan retraso, jornada, espera, viaje y km medidos                   | LP-T08    |
| LP20 | IA intenta confirmar sin línea base              | Servidor mide la línea base antes de elegir y registra carga inicial/final por unidad         | LP-T08    |

## Referencias, calidad y límites

- https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows
- https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.google.com/optimization/routing/vrp
- Código local: pedidos, grupos, calles, leases y persistencia.

El snapshot comunica la zona horaria configurada: ventanas son minutos locales,
mientras las herramientas devuelven ETA como instantes ISO UTC.

Google sólo admite cierre flexible con una ventana: envolvente es semilla, no
certificación. ETA mide viaje/espera; no hay descarga configurada, no inventarla.
Validación: unidades puras, PostgreSQL real, contratos existentes, E2E disponible,
cobertura/mutación crítica, build, lint, tipos y auditoría. Live facturable separado
con credenciales develop; fixtures existentes no cuentan como evidencia live.

Se conserva la guardia técnica heredada de llamadas de herramientas
`max(32, entregas × 8 + camionetas × 4)`. No limita pedidos y no equivale a
capacidad infinita. No se modifican el modelo, su esfuerzo ni los límites físicos
de proveedores. Las mediciones reales de latencia/costo de esta política quedan
pendientes del smoke de develop.

GREEN LIGHT para construcción. BL-058 sustituye prioridad flexible BL-028/054;
horarios siguen flexibles. BL-060 sustituye V10. Integridad con grupos, cobertura,
modalidad y autoridad manual conservada. MATCH PERFECT LP01..12 ↔ LP-T01..05.
Extensión BL-062 / LP13..15 ↔ LP-T06 autorizada por aclaración del usuario:
ingeniería de asignación y secuencia, no sólo prioridad visual.
No certifica aún pruebas live ni preparación de producción.

RED ALERT de segunda autopsia: BL-059/060 permitían carga bruta no medida. Reparado
en especificación por BL-064 y LP17..20. INTEGRIDAD TOTAL: precedencia, grupos,
ventanas flexibles, cobertura completa y autoridad del operador permanecen. MATCH
PERFECT documental: BL-064 / LP17..20 ↔ LP-T08 antes de cirugía.
