# Bloque correctivo — ruteo geográfico y contrato FinOps

Estado: autorizado para `develop` el 13 de septiembre de 2026. No modifica
Odoo, Ana V3, listas de precios, producción ni `main`.

## Autopsia

- El candidato de respaldo repartía cada destino indivisible a la camioneta con
  menos pedidos, sin usar latitud/longitud. Después Google sólo podía ordenar
  los destinos ya congelados en cada camioneta; no podía corregir una frontera
  geográfica incoherente.
- El Billing Export y el Pricing Export sí devolvían filas reales, pero la API
  REST de BigQuery serializó los `TIMESTAMP` como segundos Unix decimales. El
  parser sólo aceptaba texto ISO y descartaba el corte completo como inválido.

## Reglas normativas

| ID     | Regla                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BL-072 | Ana Rutas genera además de la propuesta global de Google un reparto `cluster-first, route-second`: destinos completos ordenados en un barrido circular alrededor de la bodega y particionados dinámicamente entre todas las camionetas.                           |
| BL-073 | La partición geográfica minimiza de forma determinista el desequilibrio de pedidos y destinos entre sectores contiguos; no contiene un máximo propio de pedidos ni separa pedidos del mismo `partnerId`.                                                          |
| BL-074 | Cada reparto se secuencia en Google con asignación fija y precedencia Alta → Media → Por horario. Si la medición vial todavía contiene retrasos, también se mide una secuencia determinista por prioridad y fecha límite; sólo se guarda el menor score completo. |
| BL-075 | Las ventanas siguen siendo flexibles: un retraso genera ETA/incidencia y nunca autoriza omitir pedidos ni bloquear **Armar ruta**. Cobertura, grupo de cliente, prioridad y versión se vuelven a comprobar antes del guardado atómico.                            |
| BL-076 | FinOps normaliza timestamps ISO y segundos Unix devueltos por BigQuery, rechaza valores vacíos/no finitos/fuera del rango de `Date` y conserva el último corte válido ante una respuesta realmente inválida.                                                      |

La Route Optimization API permite objetivos de eficiencia, puntualidad y
balance de carga, y los límites blandos permiten exceder la carga preferida sin
omitir el trabajo. Las ventanas flexibles aplican costo fuera del horario sin
volverlo una prohibición. Referencias oficiales:

- https://developers.google.com/maps/documentation/route-optimization/overview
- https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows
- https://developers.google.com/maps/documentation/route-optimization/concepts/load-demands-limits
- https://developers.google.com/maps/documentation/route-optimization/timeouts
- https://cloud.google.com/bigquery/docs/reference/standard-sql/timestamp_functions

## Escenarios de aceptación

```gherkin
Feature: distribución geográfica completa y consumo oficial visible

  Scenario: cuatro zonas y cuatro camionetas
    Given existen destinos en cuatro sectores alrededor de la bodega
    When el operador arma la ruta
    Then cada cliente permanece en una sola camioneta
    And las cuatro camionetas reciben sectores geográficos contiguos
    And se mide al menos una alternativa distinta a la propuesta global

  Scenario: prioridades y ventanas en un sector
    Given una camioneta tiene destinos Alta, Media y Por horario
    When se secuencia su recorrido
    Then ninguna prioridad inferior precede a una superior
    And dentro de la misma prioridad se considera primero la fecha límite
    And cualquier atraso se informa sin omitir el destino

  Scenario: grupo indivisible mayor que el promedio
    Given un cliente tiene más pedidos que la carga promedio por camioneta
    When se distribuyen los destinos
    Then todos sus pedidos permanecen consecutivos en una camioneta
    And el desequilibrio inevitable se mide en vez de separar al cliente

  Scenario: timestamp REST numérico de BigQuery
    Given Google devuelve export_time como segundos Unix con microsegundos
    When se agrega el corte oficial
    Then el instante se normaliza a UTC
    And aparecen uso, cuota incluida, restante y costo por SKU

  Scenario: ruta tardía pero completa
    Given todas las ventanas ya vencieron
    When el operador presiona Armar ruta
    Then todos los pedidos ruteables quedan asignados
    And los retrasos quedan medidos
    And el sistema no bloquea el guardado por el horario
```

## Puertas de salida

Unitarias de partición/orden/fecha, regresiones de cobertura y agrupación,
contrato Google, PostgreSQL real, Gherkin, cobertura medida, mutación del núcleo,
typecheck, lint y build. El smoke facturable en `develop` se ejecuta únicamente
después del despliegue manual del propietario.
