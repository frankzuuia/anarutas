# Bloque — ruteo determinista sin LLM

Fecha: 2026-09-13. Alcance exclusivo: Ana Rutas `develop`.

## Reglas de negocio

- BL-065 Autoridad: **Armar ruta** no llama OpenAI ni otro LLM. Google Route
  Optimization calcula una propuesta vial y Ana Rutas decide mediante una política
  determinista, reproducible y auditable.
- BL-066 Precedencia: todas las entregas permanecen obligatorias; pedidos del mismo
  partner de entrega permanecen juntos. En cada camioneta se ordena Alta, Media y
  Por horario; dentro de cada nivel se conservan las mejores ventanas y calles
  medidas.
- BL-067 Balance: con suficientes destinos se usa toda la flota. Google recibe
  demandas blandas calculadas por cantidad de pedidos y destinos, sin máximos de
  negocio. Ana Rutas compara la propuesta contra una línea base indivisible y elige
  por prioridad, ventana, uso de flota, jornada y calles reales. La cantidad de
  pedidos y destinos guía a Google y sólo desempata soluciones viales equivalentes.
- BL-068 Continuidad: una ventana vencida produce retraso medido, nunca omisión ni
  veto. Fallos de autenticación, coordenadas o proveedor conservan el último estado
  válido y no escriben parcialmente.

## Escenarios

| ID   | Precondición                              | Disparador | Resultado                                                                            | Recuperación                              |
| ---- | ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| RD01 | Plan, salida, pedidos y flota válidos     | Armar ruta | Cero llamadas LLM; Google y política determinista guardan una ruta completa          | Error externo conserva el borrador        |
| RD02 | Altas, medias y por horario mezclados     | Optimizar  | Cero inversiones de prioridad por camioneta; dentro del nivel mandan ventanas/calles | Retrasos quedan medidos                   |
| RD03 | Varios folios del mismo partner           | Optimizar  | Una camioneta y posiciones consecutivas                                              | Candidato que divida el grupo se descarta |
| RD04 | Destinos suficientes para toda la flota   | Optimizar  | Ninguna camioneta queda ociosa y se penaliza sobrecarga blanda                       | Sin límite duro ni pedidos omitidos       |
| RD05 | Google propone reparto concentrado        | Validar    | Se mide también una base balanceada y gana el menor score determinista               | No interviene un LLM                      |
| RD06 | Google omite o devuelve contrato inválido | Validar    | La base completa se mide por calles y se aplica sólo con cobertura exacta            | Cero escritura parcial                    |
| RD07 | Otro administrador modifica el plan       | Aplicar    | Compare-and-swap devuelve conflicto                                                  | Reintento explícito, sin duplicar         |
| RD08 | Lote mayor de 100                         | Optimizar  | Timeout de búsqueda dinámico; 100 no es límite de pedidos                            | Límite físico real se registra            |

## Flujo técnico

```text
POST /plans/:id/optimization
  -> snapshot PostgreSQL + lease
  -> optimizeTours de Google (tráfico, makespan y carga blanda)
  -> expandir grupos de cliente
  -> normalizar prioridad por camioneta
  -> medir propuesta y base balanceada con Google Routes
  -> comparación lexicográfica determinista
  -> validación de cobertura/grupos/prioridad
  -> transacción versionada + auditoría
```

## Integraciones, seguridad y costos

- OpenAI queda fuera del grafo de ejecución y de la configuración requerida.
- Google OAuth, proyecto y claves permanecen privados y ligados a la instalación.
- `searchMode=CONSUME_ALL_AVAILABLE_TIME`; el tiempo del solver se deriva del tamaño
  existente y no limita la cantidad de pedidos.
- `loadDemands` usa exclusivamente hechos presentes en el lote: un pedido y un
  destino. `softMaxLoad` se calcula con `ceil(total/flota)`, su costo es blando y
  nunca es capacidad dura ni domina una jornada vial mejor.
- Los logs sanitarios indican etapas y métricas; no contienen nombres, domicilios,
  coordenadas, secretos ni identificadores externos.

## Puertas de aceptación

1. Unitarias del constructor Google, score y grupos.
2. Integración PostgreSQL real que pruebe cero llamadas OpenAI y guardado completo.
3. Regresión 60 pedidos/4 camionetas contra reparto concentrado.
4. Gherkin para prioridad, ventanas flexibles, grupos y lote sin límite 100.
5. Typecheck, lint, build, cobertura y mutation testing dirigido.
6. Smoke facturable solamente en `develop`; nunca `main` ni producción sin orden.

Veredicto forense previo: **GREEN LIGHT**. La solución usa contratos reales ya
existentes, no añade mocks al runtime, no toca Odoo y conserva la transacción,
leases, seguridad, incidencias, mapa y recálculo manual.
