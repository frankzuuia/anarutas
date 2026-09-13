# QA — logística por prioridades, horarios y flota

Fecha: 2026-09-12. Rama local: develop. Base: a2f4997.
Código implementado; no commit, push, despliegue ni modificación del plan vivo.
Este informe no declara preparación para producción ni óptimo global.

> Evidencia histórica del motor anterior. El planificador LLM descrito en este
> documento fue retirado por `BLOQUE-RUTEO-DETERMINISTA.md`; la evidencia vigente
> se registra por separado en `QA-RUTEO-DETERMINISTA.md`.

## Resultado y alcance

Se sustituyó la aceptación de inversiones de prioridad por normalización antes
de medir. Google recibe destinos agrupados con horarios flexibles; la IA recibe
los tiempos exactos por parada y compara reparto y secuencia separadamente.
La evaluación mide retrasos, flota ociosa, carga por pedidos y destinos, jornada,
desequilibrio, espera y viaje. Los pedidos de un destino permanecen juntos.
Ventanas vencidas no vetan la ruta.

La autopsia live posterior encontró un resultado 33/20/5/2 para 60 entregas y
cuatro camionetas. La raíz no fue un límite de pedidos: el score anterior no medía
la carga bruta y el prompt indicaba expresamente no equilibrarla. La reparación
añade una línea base dinámica, construida con destinos indivisibles de mayor a
menor asignados a la unidad menos cargada. Esa línea base siempre se mide por las
calles antes de confirmar, aunque la IA no la pida. La confirmación tiene un
candado verificable: sin medición del balance base no persiste ningún candidato.
No se añadió capacidad, peso, tiempo de descarga ni máximo de pedidos.

La skill master-architect dirigió la autopsia, el contrato BL-058..062, la matriz
LP01..16 y la separación explícita de pruebas locales y proveedores reales.

## Evidencia ejecutada

| Puerta                                                       | Resultado                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Suite completa con cobertura, incluida Incidencias           | 36 archivos, 368/368 pruebas, 120.92 s                                                   |
| Statements                                                   | 92.01%, 2327/2529                                                                        |
| Branches                                                     | 84.37%, 1566/1856                                                                        |
| Functions                                                    | 96.97%, 578/596                                                                          |
| Lines                                                        | 93.27%, 2149/2304                                                                        |
| Política logística y observabilidad                          | 100% en statements, branches, functions y lines                                          |
| Mutación dirigida                                            | 235/235 detectados, 100%, 0 sobrevivientes, 0 sin cobertura, 0 timeout y 0 errores; 42 s |
| Mutación de consulta transaccional, evidencia previa intacta | 4/4 detectados, sin sobrevivientes, tiempos agotados ni errores; 55 s                    |
| TypeScript y ESLint                                          | Sin errores ni advertencias de código                                                    |
| Build Next.js                                                | PASS, compilación 8.5 s y TypeScript 4.7 s                                               |
| Playwright                                                   | 1 PASS, 2 live SKIP por configuración privada ausente; 31.2 s                            |
| Dependencias                                                 | npm audit --omit=dev: 0 vulnerabilidades                                                 |
| Integridad de diff                                           | git diff --check sin errores; avisos LF/CRLF del entorno Windows                         |

Mutación: política 96, comparación de reparto/secuencia 53, caché 15, guardia de
confirmación 13 y modelo de incidencias 58; consulta consistente en corrida separada 4.
Se reforzaron tamaño y orden de grupos, desempate por prioridad, mejor carga
alcanzable, una sola ruta permutable y catálogo de comparación vacío.
No se ocultaron ni excluyeron mutantes para alcanzar el resultado.

Objetivo por riesgo: 100% cobertura/mutación en política y evidencia de búsqueda
nuevas. Umbrales globales existentes: líneas/statements 85%, funciones 90%, ramas
80%. No sustituyen las verificaciones de rutas críticas. El orquestador completo
tiene 88.99% statements / 61.53% ramas y las calles 67.20% / 76.92%: faltan
recorridos de red real y recuperación del orquestador, declarados pendientes.

Complejidad ciclomática medida con ESLint: funciones de política máximo 4;
comparación de búsqueda 6; caché 2; evaluateCandidate 5; guardia de confirmación 6.
El orquestador planRouteWithOpenAI alcanza 64: deuda explícita, no evidencia de
arquitectura matemáticamente perfecta. No se mezcla una reescritura total de su
máquina de estados con esta corrección sin regresión live.

## Casos relevantes

- Prioridad Alta al fondo, incluso ETA iguales: se mueve antes de medir; no se
  reusan tiempos de una secuencia distinta.
- Mismo destino con varios folios: una camioneta, consecutivos, máxima prioridad
  del grupo; cuenta como un destino tardío, no como varios.
- Sucursales: identidad del partner de entrega, no nombre, referencia o matriz.
- Choferes independientes: una camioneta no espera a que otra termine Alta.
- Dos candidatos con prioridades idénticas: el que atiende temprano a los destinos
  tempranos y separa el destino que abre tarde evita dos retrasos y gana medido.
- Mejor reparto y mejor secuencia: evidencia independiente; cambiar nombres de
  camionetas no satisface la comparación. Si cambia el mejor, se reevalúa evidencia.
- Sesenta destinos independientes y cuatro camionetas: línea base exacta
  15/15/15/15; una propuesta 33/20/5/2 obtiene peor score y no puede desplazarla.
- Grupos desiguales o folios repetidos: se reparte la mejor carga alcanzable sin
  partir un destino; tamaños iguales se desempatan por prioridad y orden estable.
- La IA no puede confirmar antes de que el servidor mida la línea base balanceada.
- Salida a las 23:59, cierres a las 08:00: todos los pedidos completos y confirmables
  con atraso explícito. No error de ruta inválida por ventana.
- Caché de corrida: origen, destino, salida y modo de tráfico; mismo Promise para
  consultas concurrentes idénticas, sin cachear errores ni compartir entre corridas.
- Fallo en una camioneta: termina la medición ya iniciada de las demás antes de
  propagar error. Manual conserva el orden del operador, con diagnóstico.
- PostgreSQL real desechable: no escribe una secuencia invertida; conserva versión
  y plan. Resultado válido guarda avisos y los devuelve iguales al releer.
- Seguridad existente: sesión, Origin, actor activo, idempotencia, edición
  concurrente, aislamiento y privacidad ejercitados por suite/E2E local.

Las unidades nuevas usan cálculos puros y puntos coincidentes de distancia real
cero; no sustituyen servicios externos. La suite heredada incluye respuestas
fabricadas de proveedores para contratos/orquestación: esos casos NO acreditan
una integración real con Google/OpenAI. Gherkin documentado en acceptance.feature;
la suite no usa un ejecutor Cucumber separado.

## Reproducción local

Desde la raíz de Ana Rutas, Node 24 y dependencias del lockfile:

```powershell
npm run typecheck
npm run lint
npm run test:coverage
npm run test:mutation:route-logistics
npm run test:mutation:route-incidents-query
npm run test:e2e
npm audit --audit-level=high
git diff --check
```

Artefactos locales regenerables: coverage/coverage-summary.json,
reports/mutation/route-logistics.json y .html. La configuración Stryker incluye un
rango de la guardia candidateCommitDecision; actualizarlo si cambia su posición.

## QA pendiente de develop

No hubo llamada facturable con este código nuevo. El panel consultado mantiene el
plan Prueba 2: 61 folios, 60 entregas elegibles; Sanborns S00037 está en Recoge.
Su exclusión no es un fallo del optimizador ni se debe cambiar sin instrucción.

Tras autorización del avance a develop y despliegue manual:

1. Registrar versión del plan, salida, destinos y camionetas antes de Armar ruta.
2. Seguir logs correlacionados: preparación, propuesta Google, precedencia,
   medición, comparación de reparto y secuencia, comparación final y guardado.
3. Verificar todos los IDs elegibles exactamente una vez, grupos indivisibles,
   Alta→Media→Por horario por camioneta, carga inicial/final por unidad, ETA y
   geometría del orden final.
4. Confirmar atrasos visibles, sin exclusión por ventana. Releer tras refrescar.
5. Comprobar auditoría: logisticsPolicy, initialScore, score y search.complete.
6. Medir wall time, ciclos, llamadas y consumo de proveedor. No se publica SLO
   de latencia/costo sin esa muestra; cero omisiones y cero inversiones sí son
   invariantes verificables en todos los casos aceptados.

Hay una prueba opt-in en tests/e2e/route-groups-live.spec.ts para replay de datos
reales con PostgreSQL aislado y credenciales privadas del entorno. Esta sesión no
dispone de su configuración. No habilitarla contra producción ni con secretos
en el repositorio. Pendiente de evidencia live antes de declarar listo o promover.

## Limitaciones expresas

- ETA es previsión, no llegada ni entrega real. No hay tiempos de descarga
  configurados; no se inventaron. Incidencias reales requiere el evento del chofer.
- Google recibe una envolvente flexible para ventanas múltiples; la evaluación
  verifica todas las ventanas exactas antes de elegir.
- Se elige el mejor de los candidatos medidos e incluye obligatoriamente la línea
  base balanceada; no se certifica óptimo global.
- Conserva la guardia heredada max(32, entregas×8+camionetas×4) de tools, leases y
  límites físicos del proveedor; no existe límite nuevo de 100 pedidos ni tokens.
- Un fallo auténtico de proveedor, permiso o dato indispensable no se disfraza de
  ruta válida. El plan previo se conserva, no se produce escritura parcial.

Reversión: cambio de código en develop; no hay migración nueva. El bloque no ha
alterado datos de negocio, Five, Ana V3, Luna, Odoo ni producción.
