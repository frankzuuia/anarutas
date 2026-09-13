# QA — logística por prioridades, horarios y flota

Fecha: 2026-09-12. Rama local: develop. Base: 8482923.
Código implementado; no commit, push, despliegue ni modificación del plan vivo.
Este informe no declara preparación para producción ni óptimo global.

## Resultado y alcance

Se sustituyó la aceptación de inversiones de prioridad por normalización antes
de medir. Google recibe destinos agrupados con horarios flexibles; la IA recibe
los tiempos exactos por parada y compara reparto y secuencia separadamente.
La evaluación mide retrasos, flota ociosa, jornada, desequilibrio, espera y viaje.
Los pedidos de un destino permanecen juntos. Ventanas vencidas no vetan la ruta.

La skill master-architect dirigió la autopsia, el contrato BL-058..062, la matriz
LP01..16 y la separación explícita de pruebas locales y proveedores reales.

## Evidencia ejecutada

| Puerta | Resultado |
| --- | --- |
| Suite completa con cobertura, incluida Incidencias | 36 archivos, 361/361 pruebas, 117.91 s |
| Statements | 91.78%, 2278/2482 |
| Branches | 84.46%, 1555/1841 |
| Functions | 96.85%, 554/572 |
| Lines | 93.06%, 2108/2265 |
| Política / comparación / caché / modelo y consulta de incidencias | 100% en las cuatro métricas |
| Mutación dirigida | 197/197 detectados, 0 sobrevivientes, 0 sin cobertura, 0 errores; 47 s |
| Mutación de consulta transaccional | 4/4 detectados, sin sobrevivientes, tiempos agotados ni errores; 55 s |
| TypeScript y ESLint | Sin errores ni advertencias de código |
| Build Next.js | PASS, compilación 3.2 s |
| Playwright | 1 PASS, 2 live SKIP por configuración privada ausente; 29.3 s |
| Dependencias | npm audit --audit-level=high: 0 vulnerabilidades |
| Integridad de diff | git diff --check sin errores; avisos LF/CRLF del entorno Windows |

Mutación: política 59, comparación de reparto/secuencia 53, caché 15, guardia de
confirmación 12 y modelo de incidencias 58; consulta consistente en corrida separada 4.
Se reforzaron las pruebas de frontera temporal, una sola ruta
permutable y catálogo de comparación vacío para detectar mutaciones sobrevivientes.
No se ocultaron ni excluyeron mutantes para alcanzar el resultado.

Objetivo por riesgo: 100% cobertura/mutación en política y evidencia de búsqueda
nuevas. Umbrales globales existentes: líneas/statements 85%, funciones 90%, ramas
80%. No sustituyen las verificaciones de rutas críticas. El orquestador completo
tiene 87.41% statements / 61.82% ramas y las calles 67.20% / 76.92%: faltan
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
   Alta→Media→Por horario por camioneta, ETA y geometría del orden final.
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
- Se elige el mejor de los candidatos medidos, no se certifica óptimo global.
- Conserva la guardia heredada max(32, entregas×8+camionetas×4) de tools, leases y
  límites físicos del proveedor; no existe límite nuevo de 100 pedidos ni tokens.
- Un fallo auténtico de proveedor, permiso o dato indispensable no se disfraza de
  ruta válida. El plan previo se conserva, no se produce escritura parcial.

Reversión: cambio de código en develop; no hay migración nueva. El bloque no ha
alterado datos de negocio, Five, Ana V3, Luna, Odoo ni producción.
