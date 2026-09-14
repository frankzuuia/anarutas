# QA · paradas colocalizadas y mapa

## Riesgo cubierto

- Clientes diferentes no se presentan como varios pedidos de un solo cliente.
- Un segundo clic en el mismo pin cierra la ficha de información.
- Una camioneta no abandona una coordenada para regresar después dentro del mismo nivel de prioridad sin medir primero la alternativa contigua.
- Los pedidos de un mismo cliente permanecen indivisibles y las prioridades no se mezclan.

## Evidencia reproducible

```bash
npm run typecheck
npm run lint
npm test -- --run tests/route-map-markers.test.ts tests/route-logistics-policy.test.ts
npm run test:coverage
npm run test:mutation:route-logistics
npm run build
```

## Aceptación manual en develop

1. Armar otra vez el borrador de prueba después del despliegue.
2. Abrir el mapa y confirmar que Xokol y Nejayote aparecen en puntos distintos.
3. Confirmar que Cocos Locos Bugambilias y Metate y café aparecen en el mismo punto con dos números de parada, no con la leyenda `2 pedidos`.
4. Pulsar dos veces ese pin y confirmar que la ficha blanca se cierra.
5. Confirmar en la lista lateral que los clientes del mismo punto quedan consecutivos cuando esa variante gana la comparación medida.
6. Revisar en EasyPanel el evento `routing.colocation.prepared` y la comparación final.

## Métricas de salida

- TypeScript, ESLint y compilación de Next.js: aprobados.
- Vitest completo: 36 archivos y 361 pruebas aprobadas.
- Cobertura V8: 93.19 % statements, 86.68 % branches, 97.17 % functions y 94.52 % lines.
- Cobertura de `route-geographic-planner.ts`: 98.29 % statements, 95.65 % branches, 100 % functions y 99.03 % lines.
- Mutation testing del dominio logístico: 96.94 % global, 568 mutantes eliminados, 3 timeouts, 17 sobrevivientes, 1 sin cobertura y 0 errores; umbral de 95 % superado.
- Invariantes cubiertas: cero pedidos omitidos, cero grupos de cliente divididos y cero conflictos de prioridad introducidos por la variante.

Resultados ejecutados el 14 de septiembre de 2026 sobre la rama `develop`.
