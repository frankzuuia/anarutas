Feature: Recuperación operativa de incidencias y GPS
  Scenario: RG01-02 Cerrado con foto incluso sin señal de actualización
    Given un chofer autenticado llegó a su parada y tomó una foto válida
    When envía Cliente cerrado y el panel pierde la señal SSE
    Then recibe el identificador persistido de la incidencia
    And la reconsulta automática muestra la foto, fecha y chofer sin recargar

  Scenario: RG03-04 Marcadores sin perder la lista
    Given una parada cerrada seleccionada y otras entregadas o reprogramadas
    Then la cerrada es naranja con admiración
    And las terminales no aparecen en el mapa ni como destino de guía
    But todas permanecen en Ver paradas

  Scenario: RG05-06 Cliente acepta hoy un pedido reprogramado
    Given un pedido reprogramado propio en una ruta vigente
    When el chofer confirma Reintentar pedido desde su ficha
    Then sólo ese pedido vuelve a abierto y aparece en el mapa
    And la visita anterior se cierra con auditoría
    And entregar exige una nueva llegada con GPS válido
    But cancelar la confirmación no cambia ningún dato

  Scenario: RG07-08 Autorización, concurrencia y recuperación de reapertura
    Given una reapertura propia con versiones actuales
    When dos solicitudes usan la misma clave de comando
    Then existe sólo un evento y el mismo recibo confirma ambas
    And otro chofer o una versión obsoleta no puede reabrir
    And un pedido entregado nunca se reabre

  Scenario: RG09-10 GPS detenido recupera sin cambiar de parada
    Given el GPS dejó de emitir muestras recientes y la actividad está visible
    When el watchdog solicita una ubicación actual
    Then una muestra real precisa dentro del radio habilita Llegué
    But una muestra vieja, imprecisa, simulada o fuera de radio no lo habilita
    And detener la actividad cancela solicitudes y descarta respuestas tardías
