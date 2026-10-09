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

  Scenario: IO15 IO16 Agrupación operativa sin mezclar el reporte
    Given incidencias de dos choferes con reposiciones, devoluciones y faltantes
    When el administrador abre Incidencias en vivo
    Then ve grupos por chofer y tipo con comentarios y evidencia privada
    And las llegadas fuera de horario aparecen en un apartado inferior
    And departamento y concepto sólo aparecen en el reporte editable

  Scenario: IO17 IO18 IO19 Lectura compartida y primer administrador
    Given una incidencia nueva sin ver
    When dos administradores la marcan Visto simultáneamente
    Then sólo el primero registra su identidad y hora
    And todos ven Visto por ese administrador sin recuadro rojo
    And se conserva el pedido, cobro, cantidad y resolución de la incidencia

  Scenario: IO20 IO21 IO22 Audio autorizado y acotado
    Given sonido activado por un gesto real del administrador
    When llegan incidencias nuevas en dos pestañas de la misma sesión
    Then sólo una reproduce una ráfaga de la duración configurada de 5, 10 o 15 segundos
    And nuevos eventos durante la ráfaga no extienden su duración
    And se detiene antes si todas las incidencias de esa ráfaga están vistas
    And un navegador que bloquea audio muestra el impedimento y conserva el aviso rojo

  Scenario: IO23 IO24 IO25 Duplicados, filtros y navegación
    Given una incidencia que ya disparó su alarma
    When se edita el comentario o cambia el filtro o la página
    Then no vuelve a sonar por esa identidad
    And el panel informa incidencias nuevas fuera del filtro
    And salir del panel detiene el sonido

  Scenario: IO26 IO27 Reconexión y más de una página
    Given un navegador sin conexión y 105 nuevas incidencias confirmadas
    When recupera la conexión
    Then drena todas las páginas de notificaciones sin perder identidades
    And emite una sola ráfaga acotada
    And todos los registros permanecen consultables con su estado compartido

  Scenario: IO28 IO29 IO30 IO31 Recepción tardía y commits concurrentes
    Given un esquema anterior con incidencias históricas y comandos de fecha antigua
    When se aplica la migración y se reciben nuevos comandos
    Then el histórico queda silencioso sin atribuirlo a ningún administrador
    And los nuevos se notifican por su inserción confirmada
    And commits concurrentes no saltan eventos
    And un rollback no produce una notificación visible

  Scenario: IO33 Integridad financiera y seguridad
    Given un pedido con incidencias y cobranza
    When administración marca Visto o modifica el comentario permitido
    Then no cambia el importe, saldo, recibos ni estado de entrega
    And solicitudes sin sesión, sin rol, con actor falsificado u origen ajeno se rechazan
