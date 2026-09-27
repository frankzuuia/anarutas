Feature: Tiempo estimado al destino activo
  Scenario: Guía y cambio de destino
    Given un chofer navega hacia una parada
    Then app y panel muestran el tiempo estimado del Navigator
    When inicia guía a otra parada
    Then se descarta el tiempo anterior antes del cálculo nuevo
    And el ETA nunca registra llegada ni entrega automáticamente

  Scenario: Todos los choferes sin mezclar tiempos
    Given hay varias ejecuciones y pantallas independientes
    When abre Tiempos por chofer
    Then cada ejecución muestra chofer, destino y su propio tiempo
    And no se suman ni promedian minutos
    When selecciona una fila
    Then cambia sólo el filtro de esa pantalla y conserva el tamaño del mapa

  Scenario: Conexión y compatibilidad
    Given una APK anterior o un dato de tiempo ausente
    Then aparece Tiempo no disponible y nunca cero inventado
    When envejece el tiempo o el GPS o se revoca la sesión
    Then no se presenta como vigente
    And un paquete atrasado no reemplaza el destino nuevo
    When registra Llegué
    Then aparece En atención
