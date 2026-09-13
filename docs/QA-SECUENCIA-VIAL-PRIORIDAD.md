# QA — secuencia vial con prioridad

Fecha: 2026-09-13. Rama: `develop`.

## Defecto de regresión

La ruta amarilla observada en develop quedó equilibrada por conteo pero hizo
regresos 1→2→3→4. El runtime ordenaba rangos después de recibir la solución
Google. La corrección elimina ese ordenamiento local: cada distribución vuelve
a Google con camioneta fija y precedencias por ruta, y Ana Rutas mide la
secuencia vial resultante sin cambiar el orden.

## Evidencia ejecutada

| Puerta                                    | Resultado                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Constructor de precedencias por camioneta | Verde: asignación fija, rangos adyacentes por ruta, cero barrera global y cero límite propio de pedidos.                                  |
| Regresión de no reordenamiento posterior  | Verde: el evaluador conserva la secuencia recibida y denuncia conflictos; `prioritizeCandidate` salió del runtime.                        |
| Integración PostgreSQL y contrato Google  | Verde: PostgreSQL efímero real, distribución más dos secuencias, ganador completo y guardado atómico; cero OpenAI.                        |
| Suite y cobertura                         | Verde: 35 archivos, 337/337 pruebas; 93.06% statements, 86.30% branches, 97.15% functions y 94.50% lines.                                 |
| Mutation testing crítico                  | Verde: 375/375 mutantes eliminados, 100% total y cubierto en política, evaluación y contrato Google.                                      |
| Typecheck, lint y build                   | Verde: `tsc --noEmit`, ESLint y build Next.js 16.3.4.                                                                                     |
| Diff y seguridad                          | Verde: `git diff --check`; logs con lista cerrada de campos, sin direcciones, nombres, tokens ni credenciales.                            |
| Smoke facturable en develop               | Pendiente: commit/push a `develop` autorizados; después del deploy manual debe auditarse el mapa real y los logs de segunda optimización. |

La integración automatizada sustituye únicamente el transporte HTTP facturable
de Google y valida el JSON exacto enviado y recibido. No constituye un smoke
live del proveedor ni modifica la base remota de develop.

## Resultado

Puertas locales: `GREEN`. Validación live: pendiente. El usuario autorizó
commit/push a `develop`; el deploy permanece manual y no se autorizó `main`.

## Referencias oficiales

- https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel#PrecedenceRule
- https://developers.google.com/maps/documentation/route-optimization/parameter-list
