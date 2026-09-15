Feature: FD armado global único sin sustitución del recorrido
  Background:
    Given un administrador activo opera sólo la instancia Ana Rutas autorizada

  Scenario Outline: FD01 FD07 tamaños variables sin capacidades artificiales
    Given el borrador tiene <pedidos> pedidos elegibles y <camionetas> camionetas
    When pulsa Armar ruta
    Then todos los destinos están representados en una única solicitud OptimizeTours
    And el reparto considera carga blanda y duración global
    And no se fija un máximo de pedidos ni un reparto idéntico obligatorio
    Examples:
      | pedidos | camionetas |
      | 1       | 1          |
      | 3       | 7          |
      | 37      | 3          |
      | 61      | 4          |
      | 117     | 6          |

  Scenario: FD02 conservar la propuesta vial completa
    Given Google responde con una secuencia completa que incluye una excepción de prioridad
    When Ana Rutas valida la respuesta
    Then conserva exactamente las camionetas y secuencia del proveedor
    And informa la excepción como previsión sin bloquear el guardado
    And no genera un sort ni otros candidatos ni solicitudes Compute Routes
    And conserva kilómetros tiempos trazos y regreso

  Scenario: FD03 FD04 varios pedidos en una visita física
    Given dos pedidos pertenecen al mismo destino
    And otro cliente comparte exactamente coordenada confirmada y horarios
    When se construye el modelo
    Then representa una visita física con pedidos y clientes independientes
    And al expandir el resultado conserva pedidos contiguos sin duplicar tramos ni kilómetros
    But un punto cercano o con horarios diferentes permanece separado

  Scenario: FD05 ventanas múltiples y pruebas históricas
    Given el cliente recibe de 08:00 a 10:00 o de 12:00 a 14:00
    When se arma un plan de ayer con salida posterior a esas ventanas
    Then el modelo conserva las alternativas reales y cierres flexibles
    And no inventa disponibilidad continua durante el intervalo cerrado
    And no omite el pedido por haber vencido el horario

  Scenario: FD06 fallo del único Fleet
    Given el proveedor devuelve error o cobertura incompleta
    When Ana Rutas recupera el armado
    Then no reintenta OptimizeTours
    And prepara sólo una recuperación geográfica medida con Routes
    But si también falla la medición conserva el borrador anterior sin datos ficticios

  Scenario: FD08 FD10 seguridad e integridad transaccional
    Given el usuario queda inactivo o el plan o sus preferencias cambian durante el cálculo
    When llega la respuesta externa
    Then no sobrescribe el estado vigente
    And libera la reserva sin reintentos facturables
    And una respuesta duplicada incompleta o con índices inválidos nunca se guarda parcialmente

  Scenario: FD09 movimiento manual
    Given hay una ruta guardada
    When el administrador mueve un pedido a otra camioneta o posición
    Then conserva exactamente su decisión y recalcula por el worker existente
    And no ejecuta Fleet Routing
