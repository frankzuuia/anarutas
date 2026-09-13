# Bloque — secuencia vial con prioridad

Fecha: 2026-09-13. Alcance exclusivo: Ana Rutas `develop`.

## Autopsia

La corrida real de 60 pedidos produjo cuatro rutas 15/15/15/15, pero la ruta
amarilla regresó varias veces sobre el mismo corredor. La causa no fue Google:
Ana Rutas recibió su secuencia y después ejecutó un `sort` por rango. Ese cambio
movió la prioridad al frente sin volver a resolver las calles.

## Reglas de negocio

- BL-069 Secuencia indivisible: el administrador exige Alta→Media→Por horario
  dentro de cada camioneta. La precedencia forma parte del modelo vial; queda
  prohibido ordenar una secuencia después de optimizarla.
- BL-070 Optimización en dos fases: Google propone una distribución completa.
  Ana Rutas fija cada destino a su unidad, genera precedencias únicamente entre
  niveles de esa unidad y Google optimiza nuevamente calles, ventanas y ETA.
- BL-071 Continuidad e integridad: pedidos del mismo destino siguen juntos;
  ventanas vencidas generan incidencias y nunca omisiones. Un fallo de cualquier
  fase conserva el borrador anterior mediante lease, versión y transacción.

Actores: administrador autenticado y servicio de Ana Rutas. Datos leídos:
snapshot, vehículos, destinos, coordenadas, ventanas y prioridad. Datos escritos:
solamente el ganador completo y su auditoría. Permisos y secretos permanecen en
el servidor. Validación: cobertura exacta, grupos indivisibles, vehículo fijado,
cero inversiones de prioridad y medición vial completa.

## Matriz de escenarios

| ID   | Precondición                            | Disparador | Resultado                                          | Recuperación                                 |
| ---- | --------------------------------------- | ---------- | -------------------------------------------------- | -------------------------------------------- |
| SV01 | Prioridad aparece tarde en la semilla   | Refinar    | Google reoptimiza; ningún sort posterior           | Candidato inválido se descarta               |
| SV02 | Varias prioridades en una unidad        | Refinar    | Todas las Altas preceden Medias y éstas a horario  | Cero escritura si Google incumple            |
| SV03 | Dos camionetas con niveles distintos    | Refinar    | Reglas sólo intrarruta; sin barrera global         | Cada unidad conserva autonomía               |
| SV04 | Pedidos repetidos del mismo partner     | Refinar    | Un destino, una unidad, posiciones consecutivas    | División rechazada                           |
| SV05 | Distribución Google y base equivalentes | Comparar   | Una sola secuenciación por asignación              | No se factura trabajo duplicado              |
| SV06 | Ventanas incompatibles                  | Optimizar  | Ruta completa con retrasos medidos                 | La ventana no veta                           |
| SV07 | Más de 100 pedidos                      | Construir  | Sin límite local; reglas derivadas de datos reales | Límite físico del proveedor queda observable |
| SV08 | Proveedor, versión o contrato falla     | Aplicar    | Último borrador intacto                            | Reintento explícito                          |

## Flujo y contrato Google

```text
snapshot + lease
  -> OptimizeTours de distribución
  -> candidatos de asignación completos y deduplicados
  -> allowedVehicleIndices por destino
  -> precedenceRules sólo entre rangos de la misma camioneta
  -> OptimizeTours de secuencia
  -> validación de cobertura/grupos/precedencia
  -> medición exacta con Google Routes
  -> score lexicográfico
  -> persistencia atómica versionada
```

`PrecedenceRule` relaciona eventos de entrega mediante índices. Como el segundo
modelo fija `allowedVehicleIndices`, las relaciones no sincronizan camionetas.
Se conectan sólo niveles adyacentes presentes; la transitividad evita reglas
redundantes Alta→Por horario cuando existe Media. No se codifica un máximo de
pedidos. Google documenta que muchas precedencias elevan la complejidad y pueden
ser rechazadas: ése es un límite físico observable, no una regla de negocio.

## Veredicto previo

**GREEN LIGHT — INTEGRITY TOTAL — MATCH PERFECT.** SV-T02..06 corresponden uno
a uno con constructor, runtime, orquestación, pruebas y puertas. No cambia Odoo,
clientes, flota, incidencias, autenticación, Five, main ni producción.
