Feature: Pedidos manuales y cálculo vial por camioneta
  Scenario: Importar folios sin consultar primero la fecha
    Given un borrador vacío y una camioneta disponible seleccionada
    When administración confirma folios exactos de surtidos validados en Odoo
    Then la camioneta y los pedidos se guardan juntos en una transacción
    And no se exige una consulta previa de pedidos por fecha

  Scenario: Reintento de importación manual
    Given los folios ya importados en el mismo plan
    When administración confirma de nuevo esos folios
    Then no se duplican pedidos ni camionetas
    And no se incrementa la versión si no hubo cambios

  Scenario: Primer recorrido manual al publicar
    Given paradas confirmadas en el orden que fijó administración y ninguna ruta calculada
    When administración confirma la publicación
    Then se calcula el recorrido vial de esa camioneta sin invocar la optimización de flota
    And se conserva exactamente el orden y las coordenadas de las paradas
    And la publicación ocurre sólo después de terminar un cálculo vigente

  Scenario: Mover una parada dentro de una camioneta
    Given recorridos vigentes de dos camionetas
    When administración mueve la parada 2 a la posición 3 de la primera
    Then sólo se vuelve a calcular el recorrido de la primera camioneta
    And la segunda reutiliza sin cambios su recorrido anterior
    And ninguna parada se reordena automáticamente ni cambia de punto

  Scenario: Pasar un pedido entre dos camionetas
    Given recorridos vigentes de tres camionetas
    When administración inserta un pedido de la primera entre las paradas 3 y 4 de la segunda
    Then sólo se recalculan los recorridos de la primera y la segunda
    And la tercera reutiliza sin cambios su recorrido anterior

  Scenario: Ediciones sucesivas antes del cálculo
    Given varias ediciones manuales consecutivas del mismo plan
    When vence la ventana breve de consolidación sin más cambios
    Then el worker calcula la última versión una sola vez
    And no cobra una solicitud vial por cada arrastre intermedio

  Scenario: Fallo o versión obsoleta antes de publicar
    Given un cálculo vial fallido o una edición concurrente
    When administración intenta publicar
    Then no se publica una versión incompleta u obsoleta
    And el error permite corregir o reintentar sin duplicar el plan
