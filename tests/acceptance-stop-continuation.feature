Feature: Guía a un destino y continuación después de atención confirmada
  Scenario: Destino elegido con otras paradas pendientes
    Given una ruta con cuatro paradas y su trazado publicado
    When el chofer inicia guía a la parada dos o recupera esa guía al abrir el mapa
    Then sólo ve el camino de navegación a la dos
    And conserva los puntos de las demás paradas pendientes

  Scenario: Entrega completa y siguiente parada explícita
    Given el chofer atiende una parada con varios pedidos
    When confirma la entrega de sólo uno
    Then permanece en atención sin aviso de siguiente parada
    When el servidor confirma la última entrega y se relee la ejecución
    Then aparece Ir a la siguiente parada y Cerrar
    When elige Ir a la siguiente parada
    Then se finaliza la visita anterior sin alterar sus pedidos
    And se inicia guía al siguiente punto pendiente según el orden publicado
    And aún debe registrar una llegada GPS válida allí

  Scenario: Cliente cerrado y cierre manual del aviso
    Given una incidencia de cliente cerrado con fotografía
    When el servidor confirma su recibo y se relee la parada
    Then aparece el aviso y la parada conserva su reintento pendiente
    When el chofer pulsa Cerrar o atrás
    Then no se inicia ninguna guía ni se modifica ninguna entrega
    And los refrescos posteriores no vuelven a abrir el aviso consumido

  Scenario: Fallo de red y recuperación idempotente
    Given un envío pendiente sin confirmación
    Then no aparece un aviso de éxito ni se cambia automáticamente el destino
    When Verificar envío confirma el mismo comando y se relee la ejecución
    Then aparece un único aviso sin duplicar entrega o incidencia

  Scenario: Última parada y cambios concurrentes
    Given entregadas y reprogramadas no son candidatas automáticas
    When termina la última parada con pendientes anteriores
    Then se ofrece la primera pendiente anterior distinta de la actual
    And se revalida con la ejecución más reciente al pulsar
    When no existe otra parada con ubicación y pedidos atendibles
    Then sólo se ofrece Cerrar sin cerrar ni liquidar la ruta
