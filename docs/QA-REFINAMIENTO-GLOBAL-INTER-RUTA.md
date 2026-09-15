# QA — refinamiento global entre camionetas

Fecha: 2026-09-14. Rama: `develop`. Alcance: BL-083..086 / IR01..08.

## Resultado

**VERDE local.** La ruta preliminar medida permanece como línea base y el
refinamiento global sólo agrega un candidato. La respuesta refinada vuelve a
pasar por cobertura, grupos, punto físico, secuenciación Google con precedencias
y medición Google Routes. Un fallo, omisión, contrato inválido o reparto
repetido en esta etapa opcional no bloquea el armado ni altera el borrador.

No se ejecutó un smoke facturable: requiere el deploy manual del usuario en
`ana-rutas-develop`. Este informe no autoriza `main` ni producción.

## Evidencia funcional y contractual

- Constructor puro `buildGoogleRefinementRequest`: usa el ganador medido,
  conserva índices de vehículo y destino, agrupa pedidos del mismo cliente en
  una visita, valida correspondencia exacta y tiempos no decrecientes.
- El modelo refinado no contiene `allowedVehicleIndices` ni precedencias: Google
  puede mejorar globalmente el reparto. Después, la secuencia candidata sí fija
  camionetas y restablece Alta → Media → Por horario antes de medir.
- Integración con PostgreSQL real: warm start enviado sin OpenAI, reparto
  repetido deduplicado, auditoría v9 y guardado único.
- Regresión de resiliencia: un 503 exclusivo del refinamiento produce el evento
  natural `routing.google.refinement.unavailable`; la ruta base se guarda y el
  evento final continúa siendo `routing.completed`.
- Logs con lista cerrada de campos; sin nombres, domicilios, coordenadas,
  credenciales ni contenido de proveedor.

## Puertas ejecutadas

| Puerta | Resultado |
| ------ | --------- |
| Suite Vitest | 36 archivos, **383/383** pruebas |
| Cobertura global | 93.57% statements, 86.85% branches, 97.39% functions, **94.76% lines** |
| Cobertura `route-optimization-google.ts` | 97.74% statements, **96.39% branches**, 97.82% functions, **97.58% lines** |
| Mutation testing logístico | **97.57% total / 97.78% cubierto**; 912 killed, 11 timeout, 21 survived, 2 no coverage |
| Mutación contrato Google | **100%**, 181/181 detectados |
| Mutación política/evaluador | **100%**, 182/182 detectados |
| TypeScript | verde |
| ESLint | verde |
| Next.js production build | verde, 16/16 páginas generadas |
| Dependencias runtime | `npm audit --omit=dev`: **0 vulnerabilidades** |
| Playwright local | **1 passed / 2 live skipped** por ausencia deliberada de configuración externa |
| Diff | `git diff --check` verde; archivo privado local excluido del staging |

Los 21 mutantes sobrevivientes pertenecen al planificador geográfico v8 previo;
el núcleo nuevo de Google obtuvo 100%. El score total supera el umbral obligatorio
de 95%. Los E2E live de Odoo y Google permanecen reservados al smoke posterior al
deploy manual para no facturar ni escribir datos durante QA local.

## Métricas y SLO del bloque

- Integridad: 100% de pedidos elegibles o cero aplicación.
- Prioridad: cero inversiones en el candidato aplicable.
- Degradación: el refinamiento no puede eliminar la línea base ni empeorar el
  score elegido; el comparador final conserva todas las alternativas medidas.
- Concurrencia: lease renovado antes de la llamada y guardado CAS/versionado.
- Latencia: una llamada global adicional por armado; timeout dinámico existente,
  sin límite de 100 pedidos ni deadline local arbitrario.
- Costo: una operación `OptimizeTours` adicional; Routes sólo se consume si el
  reparto global es nuevo. Un duplicado no genera secuencia ni mediciones extra.

## Smoke pendiente en develop

Después del deploy manual, repetir `Prueba 2` y capturar en EasyPanel:

1. `routing.google.refinement.started` y uno de `completed`, `duplicate`,
   `rejected` o `unavailable`.
2. Cantidad total asignada, cero omisiones y cuatro camionetas usadas.
3. Ganador, tardanzas, pedidos por unidad, kilómetros, jornada máxima y tiempo
   total contra la línea base live de 311.2 km.
4. Prioridades por unidad, puntos físicos compartidos y mapa/polilíneas.
