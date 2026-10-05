Feature: Reparto y secuencia resueltos conjuntamente
  El administrador arma rutas con prioridades individuales, zonas, cierres,
  descarga y la flota real en una única solicitud Google.

  Scenario: RC01 Prioridad estricta por camioneta
    Given pedidos de prioridad alta, media y por horario
    When el administrador arma las rutas
    Then el modelo Google prohíbe pasar de una prioridad inferior a otra superior
    And no obliga a esperar a las prioridades de otra camioneta

  Scenario: RC02 Punto mixto con propietario único
    Given clientes distintos del mismo punto con prioridades diferentes
    When se prepara el modelo Google
    Then las prioridades tienen visitas y cierres propios
    And sus visitas dependen de un único propietario de ese punto

  Scenario: RC03 Pedidos repetidos y clientes del mismo rango
    Given varios pedidos del mismo contacto y otros clientes del mismo punto y rango
    When se arma el modelo
    Then comparten una visita y la descarga se cuenta una vez por contacto
    And ningún pedido pierde su identidad

  Scenario Outline: RC04 Flota variable
    Given un plan con <camionetas> camionetas
    When se arma la ruta
    Then todas son elegibles sin cuotas de prioridades ni clientes especiales
    Examples:
      | camionetas |
      | 1 |
      | 4 |
      | 5 |
      | 6 |
      | 12 |

  Scenario: RC05 Horizonte derivado
    Given un horizonte global válido que cambia de duración
    When se preparan transiciones de prioridad
    Then el delay prohibido supera el horizonte efectivo de cada ruta
    And cabe en el horizonte global aceptado por Google
    And no recorta el tiempo permitido de trabajo
    And un horizonte vacío o inválido se rechaza

  Scenario: RC06 Respuesta que incumple negocio
    Given una respuesta con inversión de prioridad o punto dividido entre vehículos
    When se valida el recibo
    Then se rechaza antes del guardado
    And la recuperación existente se informa y mide sin otro Fleet

  Scenario: RC07 Integración real
    Given pedidos leídos de Odoo y PostgreSQL aislado
    When Google resuelve el modelo nativo
    Then se hace una solicitud Fleet y no se reordena su resultado
    And el snapshot conserva kilómetros, tiempos y trazos medidos

  Scenario: RC08 Concurrencia y datos cambiados
    Given un cálculo reservado y versiones conocidas
    When hay otro cálculo o cambia el cliente, la salida o el plan
    Then las guardas impiden guardar datos obsoletos
    And se libera la reserva al finalizar o fallar

  Scenario Outline: RC09 Seguridad
    Given un solicitante <solicitante>
    When intenta calcular o leer el plan
    Then recibe <estado> sin iniciar integración externa
    Examples:
      | solicitante | estado |
      | anónimo | 401 |
      | liquidador | 403 |
      | origen ajeno | 403 |

  Scenario: RC10 Recibo real en el panel
    Given el recibo Google completo guardado
    When el administrador abre el mapa y filtra camionetas
    Then todos los pedidos y horarios corresponden a ese recibo
    And ningún punto pertenece a dos camionetas

  Scenario: RC11 Operación existente
    Given orden manual, publicación, chofer y liquidación existentes
    When se entrega el nuevo armado automático
    Then sus contratos operativos permanecen intactos

  Scenario: RC12 Cierre físicamente imposible
    Given un recorrido con atraso previsto
    When se muestra la ruta
    Then el atraso sigue visible
    And no se oculta ni se sacrifica cobertura o prioridad
