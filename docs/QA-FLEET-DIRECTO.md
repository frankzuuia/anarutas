# QA FD — recorrido directo, 15/09/2026

## Resultado y límites de la evidencia

Corrección de la sustitución comprobada de 257632 m de Google por 442329 m del
comparador local. En éxito, la única respuesta conserva asignación, secuencia,
ETA, métricas, polilíneas y regreso hasta PostgreSQL. Ya no existe sort, reparación
de asignación, comparación lexicográfica ni veto de prioridad posterior a Google.

**Cero optimizaciones Google facturables ejecutadas para este QA.** No se accedió
a producción, Odoo ni las cuentas de facturación. El contrato HTTP reutiliza el
arnés aislado existente; no se presenta como prueba del servicio Google real.
La regresión numérica usa el agregado del registro real, no una reconstrucción
inventada de las coordenadas o de toda su respuesta. La calidad de la próxima
solución vial real queda pendiente del deploy/prueba manual autorizados.

## Puertas ejecutadas

| Verificación                            | Evidencia                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unidades/contratos/integración          | **425/425**, 38 archivos, 122.40 s                                                                                                                          |
| Integración del orquestador             | **2/2** con PostgreSQL efímero real; respuesta con inversión guardada intacta, cero lectura vial en éxito, recuperación tras 503 con una sola llamada Fleet |
| Cobertura global                        | 95.77% líneas, 88.09% ramas, 97.91% funciones                                                                                                               |
| Nuevo modelo/adaptador directo          | **100% líneas, ramas y funciones**                                                                                                                          |
| Orquestador                             | 97.33% líneas / 68.18% ramas; incluye ramas opcionales de logs/errores y defensa de presupuesto inalcanzable en el flujo de una llamada                     |
| Persistencia                            | 97.40% líneas; exactitud, transacción, versiones/fingerprint y grupo de cliente siguen validados                                                            |
| Presupuesto Fleet                       | 100% cobertura y mutación **5/5**                                                                                                                           |
| Mutación modelo/adaptador + presupuesto | **98.99%**, 294/297 eliminados, 3 sobrevivientes revisados, cero sin cobertura/timeout                                                                      |
| Tipos / lint / build                    | Verdes; build Next 16.3.4                                                                                                                                   |
| Seguridad de dependencias de ejecución  | `npm audit --omit=dev`: cero vulnerabilidades reportadas                                                                                                    |
| E2E local                               | 1/1 panel: dos sesiones, CSRF, revocación, flota y reinicio; 2 live omitidos por requerir Odoo/Google y gasto                                               |
| Complejidad                             | ESLint: núcleo/adaptador sin funciones >15; orquestador 27, principalmente control de fallo/logs/transacción; no umbral nuevo aprobado ni ocultado          |

La primera mutación detectó 77 aserciones insuficientes; se reforzaron coordenadas,
ecuaciones, etiquetas, carga, cronología, diagnósticos y errores específicos.
No se bajó el umbral para hacer pasar la prueba. Los tres sobrevivientes restantes
son equivalencias revisadas: `end < arrival` frente a `<=` después del retorno
previo por llegada dentro de ventana; cadena de respaldo nunca consultada en una
ruta vacía; y guardia de fecha final opcional, donde `Date.parse(undefined)` produce
NaN y la comparación sigue siendo falsa. No se silenciaron mutantes.

## Regresiones FD y trazabilidad

- FD01/07: tamaños 1, 3, 8, 37, 61, 83 y 117 pedidos con 1..7 camionetas,
  incluso más unidades que entregas. Sin un límite de negocio en esos valores.
- FD02/10: el caso de 257632 m conserva distancia, secuencia, ETA y trazos;
  PostgreSQL acepta previsiones de prioridad y mantiene cobertura exacta.
- FD03/04: mismo contacto contiguo, clientes distintos separados en datos, sólo
  puntos/horarios idénticos comparten visita; no doble conteo de viaje/espera.
- FD05: alternativas de horario, huecos cerrados, salida 23:59 y fecha histórica.
- FD06: 503 sin segundo OptimizeTours; recuperación local medida. Respuestas
  incompletas, índices repetidos/desconocidos, retorno ausente y tiempos invertidos
  rechazados antes de persistencia parcial. Ningún dato vial se inventa.
- FD08: seguridad/versionado/persistencia cubiertos por `routing.test.ts`,
  `route-ai-integration.test.ts`, pruebas de lease, auth y E2E del panel.
- FD09: `recalculation.test.ts`/`routing.test.ts`; no cambios al worker, arrastre
  manual, selección Odoo ni modelos de peso.

Gherkin vigente: `tests/acceptance-direct-fleet.feature`. Los bloques anteriores
MG/FC de armado multicandidato quedan históricos; no cambian los de CRUD/manual.

## Reproducción sin gasto de optimización

Ejecutar desde Ana Rutas, sin variables de opt-in `RUTAS_QA_ROUTING_CASE` ni de
los escenarios live. No configurar credenciales Google para estas pruebas.

```bash
npm run typecheck
npm run lint
npm run test:coverage
npm run test:mutation:direct-fleet
npm run build
npx playwright test
npm audit --omit=dev
git diff --check
```

Build y E2E se ejecutan en ese orden, no en paralelo sobre `.next`.
Artefactos locales: `coverage/coverage-summary.json`,
`reports/mutation/direct-fleet.json`, `test-results/`. Sin secretos en commit.

## Contrato de gasto y operación

- Una solicitud OptimizeTours por armado; factura por visitas enviadas, no por
  el simple número de solicitudes. Logs/auditoría distinguen ambos conteos.
- Cero Compute Routes en un armado exitoso. Si Fleet falla, únicamente la rama
  de recuperación puede consultar Routes para obtener medidas reales.
- Los movimientos manuales siguen usando su recálculo existente: cero Fleet.
- El umbral de pedidos/destinos por camioneta es blando, calculado con el lote
  real. No equivale a una capacidad dura ni a una promesa de conteos idénticos.
- Preferencias de prioridad fuertes y finitas dentro del modelo; no se promete
  precedencia absoluta, puntualidad imposible ni óptimo matemático certificado.
- Los coeficientes son puntos del objetivo de Google, no MXN. No dependen de
  nombres, referencias simuladas, IDs particulares ni una flota de cuatro.

Aprobación de entrega limitada a develop y pruebas manuales; este QA no autoriza
main, despliegue automático, una llamada pagada de smoke ni una nueva política
de horarios/capacidad. Para revertir, revertir el commit FD en develop, sin
migraciones ni cambios a los datos maestros.
