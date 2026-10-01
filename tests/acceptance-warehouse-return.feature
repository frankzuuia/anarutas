Feature: Regreso a la bodega sin alterar entregas ni liquidación
  Scenario: Último pedido entregado con confirmación del servidor
    Given una publicación iniciada autorizada con punto de salida configurado
    And todos sus pedidos anteriores están entregados sin reintentos
    And las entregas con fuente financiera tienen un cobro confirmado
    When el servidor confirma cobro y entrega del último pedido y se relee la ejecución completa
    Then el aviso ofrece "Ir a bodega" con la dirección del punto de salida
    And sólo al pulsarlo comienza la guía Google al punto de salida real
    And el tracking transmite stopId nulo sin registrar una llegada o entrega adicional
    And los pedidos, cantidades, métricas y estado de liquidación no cambian

  Scenario Outline: Una parada sin marcador no significa ruta completa
    Given un pedido en estado <estado> aunque no tenga ubicación
    When se confirma la entrega de otro pedido
    Then no se ofrece regreso a bodega
    Examples:
      | estado         |
      | open           |
      | closed_pending |
      | rejected       |

  Scenario: Reprogramación remota de un reintento real
    Given un pedido closed_pending respaldado por una incidencia de cliente cerrado
    And el chofer salió de la visita y se encuentra lejos del cliente
    When confirma Reprogramar con las versiones vigentes
    Then se conserva la incidencia y el pedido queda rescheduled sin GPS de llegada
    And no se registra como entregado
    And entregar o rechazar sigue requiriendo una nueva llegada verificada

  Scenario: Todos los pedidos atendidos con reprogramaciones conservadas
    Given todos los pedidos están delivered o rescheduled
    When se confirma la última atención y se relee la ejecución
    Then se ofrece Ir a bodega sin borrar los reprogramados

  Scenario Outline: El servidor impide un cierre inseguro
    Given una solicitud de cierre con <falla>
    When el chofer confirma terminar ruta
    Then se rechaza el cierre sin cambiar pedidos, recibos, historial ni tracking
    Examples:
      | falla                       |
      | pedidos pendientes          |
      | entrega con cobro pendiente |
      | GPS lejano                  |
      | GPS antiguo                 |
      | GPS impreciso               |
      | ubicación simulada          |
      | publicación anterior        |
      | versión de bodega anterior  |
      | sesión de otro chofer       |

  Scenario: Confirmación en bodega y recuperación sin duplicación
    Given todos los pedidos están entregados con cobro confirmado o reprogramados y GPS válido en bodega
    When pulsa Terminar ruta
    Then el modal pregunta ¿Estás seguro de que terminaste tu ruta? con Aceptar y Cancelar
    And Cancelar no envía ni termina nada
    When acepta y el servidor confirma el cierre pero se pierde la respuesta
    Then el mismo comando recupera su recibo sin duplicar el cierre
    And se detienen guía y seguimiento sin liquidar ni borrar incidencias
    And nuevas operaciones del chofer se rechazan después del cierre

  Scenario: Cerrar el aviso y recuperar la acción
    Given todos los pedidos de la ruta están entregados
    When el chofer cierra el aviso de continuación y vuelve a abrir el mapa
    Then el botón "Ir a bodega" sigue disponible sin iniciar guía automáticamente

  Scenario: Destino actualizado o pedido reabierto durante el cálculo
    Given una solicitud de guía a bodega en curso
    When cambia la versión del punto de salida o se reabre un pedido o se retira la ruta
    Then el callback anterior no puede iniciar ni restaurar guía al destino viejo
    And no se modifican entregas ni se liquida la ruta

  Scenario: Contrato anterior o fallo recuperable
    Given el servidor no devuelve punto de salida válido o falta confirmación o SDK disponible
    When el chofer termina de revisar la última parada
    Then no se inventa un destino ni se inicia la guía
    And puede refrescar sin duplicar la entrega confirmada

  Scenario: Aislamiento y lectura sin republicación
    Given una ruta publicada existente y el punto de salida configurado
    When el chofer asignado consulta su plan
    Then recibe el origen real sin reescribir snapshot, hash o revisión
    And otro chofer sin asignación y una publicación retirada reciben rechazo de acceso
