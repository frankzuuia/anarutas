# QA — ruteo geográfico y contrato FinOps

Fecha: 13 de septiembre de 2026  
Rama: `develop`  
Alcance: BL-072..076

## Resultado

| Puerta                             | Evidencia final                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Unitarias + integración PostgreSQL | 353/353 verdes en 35 archivos                                                                               |
| Cobertura V8                       | 93.15% statements, 86.58% branches, 97.10% functions, 94.57% lines                                          |
| Núcleo geográfico                  | 98.75% statements, 97.14% branches, 100% functions/lines                                                    |
| Mutación geográfica                | 95.71% (154 muertos, 2 timeout, 7 equivalentes/sobrevivientes, 0 sin cobertura)                             |
| Mutación FinOps                    | 93.46% global; el mutante del timestamp Unix fue detectado                                                  |
| Contrato temporal observado        | `1789326939.568661` → `2026-09-13T19:15:39.568Z`                                                            |
| TypeScript                         | `tsc --noEmit` verde                                                                                        |
| ESLint                             | verde, cero warnings                                                                                        |
| Build Next.js                      | verde; 16/16 páginas generadas                                                                              |
| E2E panel                          | verde                                                                                                       |
| E2E Route Optimization live        | omitido por ausencia de credenciales proveedor en la máquina local; no sustituido por un resultado ficticio |

## Regresiones protegidas

- Cuatro sectores y cuatro camionetas conservan cargas 2/2/2/2 y fronteras
  angulares contiguas aunque la entrada llegue desordenada.
- Un cliente de ocho pedidos permanece indivisible y el resto de zonas no se
  mezcla para forzar una igualdad imposible.
- 243 combinaciones asimétricas de carga se comparan con una enumeración
  exhaustiva independiente de todas las particiones contiguas.
- Flota sobrante, lote vacío, coordenadas límite y punto pendiente fallan o
  continúan según su contrato, sin inventar ubicaciones.
- Prioridad, primer cierre, primera apertura, ángulo, radio e identidad estable
  tienen regresiones independientes.
- Las secuencias alternativas sólo cambian orden dentro de la camioneta; la
  frontera de candidato vuelve a validar cobertura exacta y grupos completos.
- BigQuery puede devolver `TIMESTAMP` ISO o segundos Unix decimales; ambos se
  normalizan, mientras vacío, infinito y fechas fuera de rango se rechazan.

## QA reproducible

```bash
npm test -- --run
npm run test:coverage
npm run test:mutation:route-logistics
npm run test:mutation:google-consumption
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/route-groups-live.spec.ts tests/e2e/panel.spec.ts
```

El smoke facturable final requiere desplegar `develop` en EasyPanel y volver a
armar el borrador real. La sincronización FinOps debe mostrar el corte exportado;
su hora puede seguir retrasada respecto a Metrics por diseño de Cloud Billing.
