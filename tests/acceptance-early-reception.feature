Feature: Recepción anticipada y una camioneta por destino
  Scenario: RA01 Recepción antes de la apertura
    Given un cliente con ventana 10:00 a 12:00 y salida a las 08:00
    When el recorrido llega a las 09:00
    Then su ETA es 09:00 sin espera ni atraso

  Scenario: RA02 Distintos horarios en la misma coordenada
    Given varios clientes con horarios distintos en un punto confirmado exacto
    When se arma la ruta con las camionetas disponibles del plan
    Then el punto se visita una sola vez por una sola camioneta
    And cada pedido conserva su identidad y cada cliente su tiempo de descarga

  Scenario: RA03 Cierre compartido
    Given un cliente cierra a las 10:00 y otro a las 13:00 en el mismo punto
    Then la alternativa puntual compartida termina a las 10:00

  Scenario: RA04 Ventanas múltiples
    Given un cliente recibe en varias ventanas y otro no tiene horario
    Then el cliente sin horario no elimina el cierre del otro
    And antes del último cierre se permite recepción anticipada sin espera

  Scenario: RA05 Límites exactos
    Then llegar exactamente al cierre es puntual
    And llegar un segundo después se reporta como atraso
    And una salida después del cierre nunca se declara puntual

  Scenario: RA06 Flota y ubicaciones variables
    Given una cantidad variable de camionetas y clientes
    Then cada pedido se conserva una vez sin reglas por nombre o camioneta
    And puntos cercanos diferentes siguen siendo destinos distintos

  Scenario: RA07 Recálculo manual
    Given asignaciones y orden decididos por el administrador
    When se recalcula el recorrido vial
    Then se conserva ese orden con recepción anticipada y descarga acumulada
    And un regreso posterior al punto vuelve a consumir servicio

  Scenario: RA08 Persistencia y seguridad
    Given una respuesta real de Google y lectura real de Odoo
    When se guarda en PostgreSQL y se consulta desde el panel
    Then conserva los pedidos y un solo chofer por punto
    And los atrasos permanecen visibles
    And se rechazan solicitudes anónimas, de origen ajeno y de rol liquidador

  Scenario: RA09 Déficit por tráfico
    Given Google declara insuficiencia por tráfico y una espera negativa
    Then el déficit se traslada a llegadas y regreso sin cambiar el reparto
    And sólo las esperas positivas disponibles absorben ese déficit

  Scenario: RA10 Respuesta inválida
    Given una espera negativa sin marca de tráfico o falta el tramo de regreso
    Then la respuesta se rechaza sin debilitar validaciones de conducción o cobertura
