# RA — recepción anticipada y punto único por camioneta

Actualización 2026-10-04: [SP — prioridad estricta](BLOQUE-PRIORIDAD-ESTRICTA.md)
sustituye la visita indivisible del punto 2 para prioridades distintas. El punto
mantiene una camioneta única; puede requerir visitas separadas para entregar
altas, después medias y finalmente por horario.

Autorizado por la corrección de rutas y la aclaración del propietario del
2026-10-04: se puede entregar antes de la apertura; no se debe llegar después
del cierre. No cambia la ficha del cliente ni sus ventanas guardadas.

## Autopsia

El modelo v4 usaba la apertura como límite duro y agrupaba por coordenadas
**y ventanas iguales**. Así dos clientes en la misma coordenada, con horarios
distintos, podían recibir camionetas distintas. En el plan real `prueba 13`
v14 se observaron dos marcadores de dos camionetas: Mariscos Chatos/Sanborns y
GÜI/Sylvestre. Estos nombres sólo documentan la regresión, no son reglas.
La evaluación de recálculo también fabricaba espera hasta la apertura.

## Contrato y alcance

1. Una ventana permite recepción anticipada desde la salida real del plan
   hasta su cierre, inclusive. Varias ventanas del mismo cliente permiten
   llegar hasta el último cierre, sin espera artificial entre ventanas.
2. En armado automático, una coordenada confirmada exacta es una visita
   indivisible. Cada cliente y pedido conserva identidad, tarjeta y servicio.
   El cierre común es el menor de los últimos cierres de sus miembros; un
   cliente sin ventana no elimina la restricción de otro.
3. Duración por cliente, prioridades, camionetas dinámicas, zonas preferidas,
   una solicitud Fleet, cobertura obligatoria y regreso permanecen vigentes.
   No se fijan clientes, cantidad de camionetas, territorios ni pesos nuevos.
4. Recálculo y recuperación usan la misma recepción anticipada. La descarga
   se suma una vez por cliente en visitas consecutivas al punto; un regreso
   manual posterior sigue consumiendo servicio.
5. Se conservan las excepciones visibles de atraso de PH: una fecha imposible
   nunca se declara puntual ni se omiten pedidos para ocultarla. La corrección
   no promete resolver un problema físicamente imposible ni altera publicación.
6. No se reescriben rutas guardadas/iniciadas ni se despliega automáticamente.
   Nueva política en auditoría/huella de solicitudes; sin migración ni APK.

## Escenarios de aceptación

```gherkin
Feature: Recepción anticipada y destinos indivisibles
  Scenario: RA01 Llegada antes de apertura
    Given un cliente recibe de 10:00 a 12:00 y la salida es 08:00
    When el recorrido llega a las 09:00
    Then la entrega se programa a las 09:00 sin espera ni atraso
  Scenario: RA02 Clientes en un mismo punto
    Given dos clientes comparten coordenadas y tienen ventanas diferentes
    When Google arma la ruta con las camionetas del plan
    Then ambos pedidos pertenecen a una visita y camioneta
    And se conservan sus identidades y la suma de descarga por cliente
  Scenario: RA03 Cierre compartido más restrictivo
    Given un cliente cierra a las 10:00 y otro a las 13:00 en el mismo punto
    Then la alternativa puntual de la visita termina a las 10:00
  Scenario: RA04 Varias ventanas y ausencia de horario
    Given un cliente tiene varios cierres y otro no tiene ventana
    Then se conserva el último cierre del cliente con horario
    And una llegada antes de su última apertura no obliga a esperar
  Scenario: RA05 Cierre exacto e imposibilidad
    Then llegar exactamente al cierre es puntual
    And un segundo después se reporta como atraso
    And salir después del cierre no fabrica una opción puntual
  Scenario: RA06 Flota y ubicación dinámicas
    Given cualquier cantidad válida de camionetas y pedidos
    Then cada pedido aparece exactamente una vez
    And puntos cercanos diferentes no se fusionan
    And nombres y asignaciones anteriores no condicionan la solución
  Scenario: RA07 Recuperación y recálculo
    Then el cálculo vial conserva recepción anticipada y descarga real
    And el recálculo manual conserva la asignación y orden del administrador
  Scenario: RA08 Integración protegida
    Then permanecen permisos, aislamiento, concurrencia y control de versiones
    And el resultado real conserva cobertura, trazos y regreso
```

## Ejecución y puertas

- RA-T01: contratos rojos, modelo y evaluación temporal/servicio coherentes.
- RA-T02: comparación Google real, destinos compartidos, atrasos, km y espera;
  inspección del reparto sin guardar el experimento en el plan remoto.
- RA-T03: unidad/regresión, cobertura crítica objetivo >=95% líneas y >=90%
  ramas (todas las decisiones nuevas de cierre y agrupación), mutaciones
  específicas, integración PG/HTTP y QA reproducible antes de develop.

No hay mocks de proveedores. Datos puros verifican aritmética; los recibos
externos provienen de solicitudes reales. Las omisiones se declaran en QA.

## Hallazgo de contrato de tráfico en la prueba real

La respuesta Google del bloque reportó `hasTrafficInfeasibilities: true` y
esperas negativas de 228, 134 y 12 segundos. El parser anterior las rechazaba
como duración inválida, provocando recuperación geográfica y pérdida del reparto
global. La corrección del mismo flujo conserva vehículos, secuencia, trazos y
conducción, traslada el déficit a las llegadas posteriores, consume sólo la espera
positiva disponible y actualiza regreso/totales. No repite Fleet ni oculta atrasos.
Valores negativos sólo se admiten en espera de rutas expresamente marcadas por
Google; conducción, totales, índices y cobertura conservan sus guardas.

```gherkin
Scenario: RA09 Tráfico impide cumplir el reloj original de Google
  Given Google marca insuficiencia de tiempo y una espera negativa
  When se interpreta la respuesta completa
  Then el déficit desplaza llegadas y regreso sin cambiar asignaciones ni trazos
  And los cierres se evalúan con esas llegadas y los atrasos permanecen visibles
Scenario: RA10 Contrato corrupto
  Given espera negativa sin marca de tráfico o falta el tramo de regreso
  Then se rechaza la respuesta y se mantiene la recuperación existente
```

Referencia oficial: [ShipmentRoute.hasTrafficInfeasibilities](https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentRoute).
