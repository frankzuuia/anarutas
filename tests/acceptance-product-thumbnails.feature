Feature: Fotos de Odoo en el pedido del chofer
  Scenario: Producto con foto
    Given una sesión de chofer con un pedido asignado y foto en Odoo
    When abre el detalle del pedido
    Then aparece una miniatura junto al nombre
    And se conservan cantidades, alertas y acciones de incidencia

  Scenario: Producto sin foto
    Given un producto sin imagen en Odoo
    When se muestra su renglón
    Then se muestra el logo Five atenuado
    And el chofer puede registrar la entrega e incidencias

  Scenario: Foto no disponible
    When Odoo falla o el dispositivo pierde conexión
    Then se conserva la miniatura descargada dentro de la vida del caché o el logo Five
    And la carga del pedido no depende de la imagen
    And se reintenta automáticamente mientras el detalle siga abierto

  Scenario: Aislamiento y compatibilidad
    When una sesión intenta leer una foto de un pedido ajeno o revisión cancelada
    Then el servidor rechaza antes de consultar el caché o Odoo
    And las publicaciones existentes no cambian sus hashes ni revisiones

  Scenario: Muchas miniaturas simultáneas
    When se abren varias líneas de un pedido al mismo tiempo
    Then el servidor comparte la consulta de imágenes del lote
    And limita el caché y renueva las imágenes al expirar
