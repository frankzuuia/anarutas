Feature: Consulta compacta de liquidación por fecha de ruta y chofer
  Scenario: Seleccionar un chofer registrado
    Given dos choferes tienen rutas con pedidos entregados y cobros distintos
    When el liquidador selecciona un chofer
    Then sólo ve sus rutas y sus totales en cada estado de liquidación
    And los recibos, solicitudes y decisiones permanecen intactos

  Scenario: Registrado sin cobros e inactivo
    Given un chofer registrado no tiene cobros y otro está inactivo
    When abre el filtro Chofer
    Then ambos aparecen y el inactivo está identificado
    And seleccionarlos sin cobros muestra cero importes y ninguna ruta

  Scenario: Registro automático y filtros persistentes
    Given el liquidador consulta un chofer y abre su ruta
    When vuelve a choferes y otro administrador registra un chofer
    Then conserva el filtro y los totales seleccionados
    And el nuevo chofer aparece sin actualizar manualmente

  Scenario: Cambiar filtros durante lecturas
    Given hay una lectura anterior y un detalle abierto
    When cambia el chofer o las fechas
    Then vuelve a la primera página sin el detalle anterior
    And una respuesta anterior no sustituye el nuevo alcance

  Scenario: Autorización y recuperación
    Given una cuenta de rutas, una cuenta revocada o un filtro inválido
    When solicita el reporte de liquidación
    Then el servidor rechaza la solicitud sin divulgar el registro de choferes
    And una lectura válida posterior devuelve los datos actuales

  Scenario: Presentación y flujo existente
    Given el panel a 1280 o 390 píxeles
    Then sólo ofrece Fecha de ruta con controles compactos y sin desborde
    And Liquidación de rutas está entre Auditoría y Control de consumo
    And liquidar por pedido y toda la ruta, aceptar, cancelar, tickets y cerrar conservan su comportamiento
