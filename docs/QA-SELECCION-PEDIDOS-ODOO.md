# QA — selección de pedidos Odoo

Fecha: 2026-09-11. Rama local: develop. Alcance exclusivo: Ana Rutas.
No hubo commit, push, merge, deploy ni escrituras en Odoo.

## Resultado funcional

El flujo de dos etapas quedó validado:

1. Camionetas + fecha consultan Odoo y crean únicamente un lote temporal.
2. El modal muestra validados y confirmados/asignados pendientes con checkbox,
   búsqueda, filtro y selección global.
3. Guardar pedidos relee toda la selección en Odoo.
4. Una sola transacción guarda camionetas y exclusivamente los pedidos marcados.
5. Un conflicto conserva la selección y no hace una importación parcial.

No se modificaron las fórmulas ni reglas de pesos/cantidades, prioridad,
ventanas, mapa, optimización, ruteo o carga manual por folio. Los campos de
cantidad se leen con la semántica existente para done y con demanda para
pendientes; no existe una nueva fórmula de peso.

## Contrato live Odoo 19.4

Lectura real contra ana-rutas-develop/app, siempre mediante version,
authenticate, read, fields_get y search_read:

| Pedido | Picking      | Estado   | Resultado                        |
| ------ | ------------ | -------- | -------------------------------- |
| S00012 | WH/OUT/00012 | done     | Validado, 1 partida              |
| S00013 | WH/OUT/00013 | done     | Validado, 3 partidas             |
| S00014 | WH/OUT/00014 | assigned | Pendiente de validar, 3 partidas |

La consulta devolvió 3 candidatos: 2 validados y 1 pendiente. La prueba eligió
S00012 y S00014, guardó exactamente 2, volvió a consultar, comprobó 2 ya
cargados, ejercitó seleccionar todos/desmarcar y provocó un conflicto de versión.
El conflicto devolvió 409, mantuvo la selección y dejó 2 pedidos en el tablero.

El contrato estático impide exponer un ejecutor Odoo genérico y falla si aparece
create, write o unlink. No se ejecutaron acciones de confirmación o validación.

## Evidencia automatizada

| Puerta                               | Resultado                                                          |
| ------------------------------------ | ------------------------------------------------------------------ |
| Pruebas + cobertura                  | 31 archivos, 307 pruebas, todas aprobadas; 155.22 s                |
| Cobertura                            | statements 90.90%, branches 84.89%, functions 96.63%, lines 92.49% |
| Línea base                           | 90.40%, 84.06%, 96.55%, 91.97%; no bajó ninguna métrica            |
| Módulo order-candidates              | statements 93.93%, branches 86.95%, functions 95.83%, lines 96.74% |
| Mutation crítico completo            | 322 mutantes; 96.89%; 244 killed, 68 timeout, 10 survived          |
| Mutation comparación exacta de flota | 7/7 killed; 100%                                                   |
| TypeScript                           | npm run typecheck, exit 0                                          |
| ESLint                               | npm run lint, exit 0                                               |
| Build producción                     | npm run build, exit 0; endpoints candidates/confirm presentes      |
| E2E general + live                   | 2/2 aprobados en 1.1 min; live 24.0 s                              |
| Dependencias runtime                 | npm audit --omit=dev: 0 vulnerabilidades                           |

Los diez supervivientes del barrido completo corresponden a optional chaining,
fallbacks equivalentes o literales de error; el único superviviente de una
decisión crítica, comparación de flota no vacía, se cubrió después y obtuvo
100% en la mutación aislada.

## Rendimiento observado

Muestra live de cinco consultas completas sobre tres pedidos:

- tiempos: 11,427; 2,728; 3,368; 3,399; 3,401 ms;
- p50: 3,399 ms;
- p95 observado: 11,427 ms, incluyendo arranque frío;
- proceso de medición: 63 MiB RSS antes, 75 MiB después, delta 12 MiB.

Es una muestra de desarrollo, no un SLO de producción.

## QA visual

Playwright verificó 375, 768, 1024 y 1440 px, sin desbordamiento horizontal,
con acciones inferiores visibles y selección indeterminada accesible. Evidencia:

- reports/screenshots/order-selection-375.png
- reports/screenshots/order-selection-768.png
- reports/screenshots/order-selection-1024.png
- reports/screenshots/order-selection-1440.png

## Seguridad y atomicidad

- Sesión y Origin exacto obligatorios.
- Fuente, modelo, empresa y credenciales proceden sólo del servidor.
- Rate limit, timeout, máximo de candidatos y expiración configurables.
- IDs opacos, pertenencia actor/plan/source y versión comprobadas.
- Relectura del 100% de seleccionados antes de guardar.
- Reintento exacto devuelve el mismo recibo.
- Candidato alterado, lote expirado, versión obsoleta o fallo SQL dejan
  camionetas, pedidos, versión y recibo sin cambios.
- Migración v9 es aditiva; backfill añade estado validado a históricos y
  conserva el hash original para no producir falsos cambios en carga manual.

## Preflight antes de producción

No se promociona todavía. Antes de desplegar deben ejecutarse:

1. fields_get y smoke read-only con las credenciales propias del Odoo 17 de
   producción;
2. lectura live de un día con más de 50 candidatos para evidenciar varias
   páginas con datos reales.

La compatibilidad está resuelta por capacidades de campos, no por una
bifurcación de versión: Odoo 17 oficial usa product_uom y Odoo 19.4 observado
usa uom_id.
