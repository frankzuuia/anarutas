# QA — ruteo determinista sin LLM

Fecha: 2026-09-13. Rama local: `develop`. Base remota observada: `a2f4997`.

## Resultado

`Armar ruta` dejó de ejecutar OpenAI/Terra. El endpoint usa Google Route
Optimization para proponer asignación y vialidad; Ana Rutas normaliza prioridad,
mide la propuesta y una base balanceada, compara métricas reproducibles y guarda
el ganador mediante la transacción versionada existente.

Jerarquía vigente:

1. cero inversiones Alta → Media → Por horario dentro de cada camioneta;
2. menos destinos tardíos y menos segundos de retraso;
3. uso de toda la flota cuando existen destinos suficientes;
4. menor hora real de término, desequilibrio de jornada, espera, viaje y distancia;
5. pedidos y destinos por unidad como desempate entre soluciones viales equivalentes.

Las cantidades también se envían a Google como `softMaxLoad` dinámico. No existe
`maxLoad`, penalización por omitir, límite de 100 pedidos ni veto por ventana. Los
pedidos del mismo partner de entrega permanecen juntos y consecutivos.

## Evidencia ejecutada

| Puerta | Resultado |
| --- | --- |
| Regresiones dirigidas | 53/53 verdes: 33/20/5/2, prioridades, ventanas vencidas, grupos, contrato Google y PostgreSQL |
| Suite completa con cobertura | 35 archivos, 332/332 pruebas, 119.04 s |
| Statements | 93.05% (2199/2363) |
| Branches | 86.19% (1486/1724) |
| Functions | 97.15% (547/563) |
| Lines | 94.54% (2029/2146) |
| Evaluador determinista | 100% statements/functions/lines; 91.17% branches |
| Mutation testing crítico | 96.96% global; política 100%, modelo Google 100%, evaluador 91.43% |
| TypeScript | `npm run typecheck` verde |
| ESLint | `npm run lint` verde |
| Build de producción | `npm run build` verde; Next.js 16.3.4 |
| Auditoría de diff | `git diff --check` sin errores de whitespace |

Los nueve mutantes supervivientes del evaluador corresponden a guardas redundantes
o representaciones internas que los dos constructores vigentes ya garantizan; no
cambian cobertura, ganador ni persistencia. El orquestador se validó con PostgreSQL
real desechable, auditoría, versión obsoleta, logs sanitizados y resultado 1/1 ante
una propuesta Google concentrada 2/0.

## Seguridad y recuperación

- Configuración Google sólo servidor; ningún secreto, cliente, domicilio o
  coordenada aparece en logs.
- El runtime y `.env.example` ya no contienen configuración OpenAI.
- Candidato duplicado, incompleto, ajeno o que divida un destino se rechaza antes
  de guardar.
- Lease, compare-and-swap y aplicación atómica permanecen; un fallo conserva el
  último borrador válido.
- No se modificó Odoo, Ana V3, Luna, Five, producción ni la base de EasyPanel.

## Validación pendiente y límite honesto

Las pruebas locales no certifican tráfico real ni cuotas del proyecto Google. Falta
un smoke facturable en `ana-rutas-develop` con el lote real después del deploy manual
del propietario. No se realizó commit, push ni deploy en esta ejecución.

## Referencias oficiales

- Google Route Optimization: https://developers.google.com/maps/documentation/route-optimization/overview
- Ventanas blandas: https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows
- Demandas y límites blandos: https://developers.google.com/maps/documentation/route-optimization/concepts/load-demands-limits
- Optimización de flota por duración global: https://developers.google.com/maps/documentation/route-optimization/assignment
- Timeouts por complejidad: https://developers.google.com/maps/documentation/route-optimization/timeouts
