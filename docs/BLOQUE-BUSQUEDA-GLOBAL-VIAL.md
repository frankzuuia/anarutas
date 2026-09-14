# Bloque — búsqueda global geográfica multisemilla

Fecha: 2026-09-14. Alcance exclusivo: Ana Rutas `develop`.

## Autopsia

La corrida real de `Prueba 2` conservó 60 entregas, cero tardanzas y 15 pedidos
por camioneta, pero recorrió 397.9 km. Ford 2026 acumuló 156.4 km y volvió a
Punto Sur después de visitar tres destinos; la unidad refrigerada cruzó varias
veces entre norte, centro y sur. El orquestador sólo produjo dos repartos y hasta
tres secuencias por reparto. El score eligió correctamente el mejor de seis
candidatos, pero no existía una búsqueda que moviera paradas o zonas entre
camionetas ni una mejora `relocate/swap/2-opt` de la secuencia.

Veredicto previo: **RED ALERT** por espacio de búsqueda insuficiente. La
corrección siguiente obtiene **GREEN LIGHT / MATCH PERFECT** porque conserva
los contratos reales de Google, cobertura, grupos, prioridades, lease y
transacción; amplía la búsqueda sin introducir LLM, mocks ni límites de pedidos.

## Reglas de negocio

| ID     | Regla                                                                                                                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BL-078 | Ana Rutas genera tres semillas completas e independientes: reparto global de Google, barrido circular balanceado y clúster multicentro balanceado. El clúster intercambia puntos completos hasta convergencia y evita depender de un único corte angular.                    |
| BL-079 | Cada reparto se secuencia en Google con precedencias y además produce una mejora geométrica `relocate/2-opt` dentro de cada nivel de prioridad hasta que ningún movimiento reduzca el recorrido. No existe un número fijo de seis candidatos ni un máximo de pedidos propio. |
| BL-080 | La búsqueda conserva cobertura exacta, grupos de cliente, puntos físicos indivisibles y precedencia Alta → Media → Por horario. Las ventanas son blandas: el retraso se minimiza y se registra, pero nunca bloquea ni omite una entrega.                                     |
| BL-081 | Clientes cercanos continúan como paradas, tarjetas y números independientes. La búsqueda puede volverlos consecutivos cuando reduce el recorrido completo; sólo coordenadas exactamente iguales son indivisibles para la asignación.                                         |
| BL-082 | Toda alternativa única se recalcula con Google Routes para ETA, regreso, distancia y polilíneas antes de poder ganar. EasyPanel publica semillas, convergencia y comparaciones sin nombres, domicilios, coordenadas ni secretos.                                             |

## Escenarios

| ID   | Precondición                                                                | Disparador        | Resultado                                                                                                          | Recuperación                                       |
| ---- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| MG01 | Sesenta pedidos y cuatro camionetas                                         | Armar ruta        | Todos los pedidos elegibles quedan en una ruta y se usa toda la flota cuando hay destinos suficientes              | Candidato incompleto se descarta                   |
| MG02 | Dos destinos cercanos de la misma zona quedan separados por un viaje lejano | Buscar vecindad   | `relocate` los vuelve consecutivos si mejora prioridad, tardanza y operación                                       | Si empeora el score conserva el orden anterior     |
| MG03 | Dos rutas mezclan norte y sur                                               | Buscar reparto    | `swap/relocate` mueve unidades físicas completas y reduce el recorrido global                                      | Nunca separa un partner ni una coordenada idéntica |
| MG04 | Un tramo admite inversión                                                   | Buscar secuencia  | `2-opt` se acepta sólo dentro del mismo nivel de prioridad y con score mejor                                       | Cero inversión Alta/Media/Horario                  |
| MG05 | Todas las ventanas vencieron                                                | Armar ruta        | La búsqueda finaliza con todos los pedidos y retrasos medidos                                                      | No existe veto horario                             |
| MG06 | Google no encuentra una ruta o devuelve contrato incompleto                 | Medir alternativa | La operación falla cerrada y el borrador anterior permanece intacto                                                | Sin guardado parcial                               |
| MG07 | Más de 100 pedidos                                                          | Preparar búsqueda | Semillas y movimientos se derivan del lote completo; ningún contador local recorta pedidos o candidatos mejorables | El timeout físico del proveedor se registra        |
| MG08 | Varias alternativas convergen                                               | Elegir finalistas | Se recalculan alternativas no dominadas y gana el score vial exacto                                                | Firmas repetidas no duplican solicitudes           |

## Flujo técnico

```text
snapshot + lease
  -> Google Route Optimization (semilla global)
  -> semilla geográfica completa
  -> Google Route Optimization (secuencia fija con precedencias)
  -> clúster multicentro con relocate/swap de puntos hasta convergencia
  -> Google Route Optimization por reparto (calles + precedencias)
  -> relocate + 2-opt geométrico dentro de cada prioridad hasta convergencia
  -> Google Routes computeRoutes para cada alternativa única
  -> score exacto + cobertura/grupos/prioridad
  -> transacción versionada existente
```

## Referencias oficiales

- https://developers.google.com/maps/documentation/route-optimization/overview
- https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows
- https://developers.google.com/maps/documentation/route-optimization/timeouts
- https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/projects/optimizeTours

Se descartó una matriz completa N×N: con 61 puntos consumiría alrededor de 3,700
elementos y con 100 superaría 10,000 por corrida. La generación geográfica usa
las coordenadas confirmadas sin llamadas externas y Google conserva la autoridad
sobre calles, tráfico, ventanas, ETA, regreso y decisión final medida.

## Puertas de salida

1. Unitarias de clúster, convergencia, secuencia y contratos Google existentes.
2. Regresiones de Punto Sur, cruces norte/sur, prioridad, ventanas y puntos
   físicos.
3. Integración PostgreSQL real: cobertura exacta, cero OpenAI y guardado único.
4. Gherkin MG01..08, cobertura y mutación del núcleo nuevo.
5. Typecheck, lint, build, auditoría de dependencias y E2E del panel.
6. Smoke facturable sólo después del deploy manual en `develop`.
