Feature: Regreso real a bodega visible en administración
  Scenario: Guía a bodega después de todas las entregas o reprogramaciones
    Given una ejecución iniciada cuyos pedidos publicados están entregados o reprogramados
    And un punto de salida configurado vigente
    When el chofer calcula o inicia la guía a esa bodega
    Then el destino auxiliar y la versión de bodega se comparten sin inventar una parada
    And avance, resumen y tiempos muestran "De regreso a bodega"
    And pedidos, cantidades, evidencias y liquidación no cambian

  Scenario: Pedidos pendientes o destino retirado
    Given una guía a bodega previamente válida
    When se reabre un reintento o cambia la versión del punto de salida
    Then el servidor deja de proyectar el destino auxiliar
    And rechaza nuevas muestras de ese regreso obsoleto sin modificar los pedidos

  Scenario: Pérdida de conexión y GPS independiente
    Given una señal de regreso aceptada con tiempo real del SDK
    When el heartbeat supera la antigüedad permitida
    Then el panel muestra "Regreso a bodega · sin confirmación reciente"
    And no extrapola el tiempo ni rejuvenece coordenadas antiguas

  Scenario Outline: Limpieza del destino y aislamiento
    Given una señal válida de regreso a bodega
    When ocurre <evento>
    Then el regreso no queda confirmado en el panel
    And la entrega y su historial se conservan
    Examples:
      | evento                         |
      | detener guía                   |
      | detener seguimiento            |
      | reiniciar sesión de seguimiento|
      | revocar dispositivo o sesión   |
      | cancelar publicación           |
      | terminar ruta en bodega         |

  Scenario: Compatibilidad y concurrencia
    Given una APK anterior sin destino auxiliar y una migración desde schema32
    When se reciben muestras repetidas o desordenadas y se aplica la migración concurrentemente
    Then se conserva el contrato de destinos de clientes
    And sólo la secuencia nueva modifica la última muestra
    And los datos anteriores permanecen sin backfill de destinos
