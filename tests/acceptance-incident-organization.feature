Feature: Incidencias de producto separadas del reporte de devoluciones
  # IO-T01/02 y contratos de los bloques aprobados.
  Scenario: IO04 Selector de llegada sin faltantes
    Given el chofer atiende una parada autorizada
    When abre Registrar incidencia desde el mapa
    Then sólo aparecen Cliente cerrado y Pedido rechazado
    And los faltantes siguen disponibles dentro del pedido

  Scenario: IO07 Cambio de tipo y edición de capturas anteriores
    Given una devolución nueva con comentarios seleccionados
    When el chofer cambia a reposición
    Then se retiran sólo las selecciones incompatibles del borrador
    And una captura histórica conserva sus comentarios hasta una edición explícita
    And el formulario avisa si debe retirar un comentario anterior incompatible
  Scenario: IO01 IO02 Cuatro tipos en reporte y Excel
    Given cinco incidencias reales, una de cada tipo, en una ejecución
    When administración consulta el reporte y exporta el Excel
    Then aparecen únicamente los dos faltantes y las dos reposiciones
    And la devolución conserva su registro, cantidad y fotos privadas
    And el Excel conserva nueve columnas, tipos, formatos y protección contra fórmulas

  Scenario: IO05 IO06 Devolución nueva con evidencia obligatoria
    Given un chofer autorizado en una visita activa con formulario versión 3
    When reporta devolución sin departamento ni concepto
    Then puede seleccionar especificaciones, mala calidad y producto golpeado
    And el servidor rechaza el guardado sin fotografía válida
    And con evidencia guarda incidencia, fotos y recibo atómicamente

  Scenario: IO08 Compatibilidad de comandos que ya estaban en la APK
    Given un comando versión 2 y tres fotografías
    When la APK lo envía y reintenta
    Then la representación y el recibo permanecen compatibles
    And sólo existe una incidencia con sus fotos

  Scenario: IO09 IO10 Nuevos catálogos sin reinterpretar historia
    Given una captura nueva de faltante desde bodega
    When el chofer elige Error en compra y No venía el producto en el pedido
    Then el servidor acepta los códigos autorizados y persiste el motivo
    And ningún comentario histórico se reclasifica

  Scenario: IO12 IO13 Corrección administrativa concurrente
    Given dos administradores con la misma versión de una reposición
    When ambos corrigen el comentario
    Then sólo uno guarda y el otro recibe conflicto de versión
    And se conservan comentario del chofer, actor y cambios antes y después
    And reporte, vista en vivo y Excel usan el comentario administrativo
    And cantidades, saldo y estado del pedido no cambian

  Scenario: IO14 Permisos y alcance del editor
    Given un visitante, una cuenta sin rol de rutas o un administrador
    When intenta modificar una incidencia fuera de su autorización o editar importes
    Then se rechaza la solicitud sin cambiar incidencia, anotación ni cobro

  Scenario: IO32 Migración reiniciada
    Given una instalación de prueba con esquema 45
    When se solicita concurrentemente la migración nueva y se repite
    Then queda una sola estructura consistente con referencias válidas
    And se preservan los registros previos
