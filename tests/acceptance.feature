Feature: Ana Rutas independiente y portable
  Scenario: Contraseñas de seis caracteres para administradores
    Given una instalación con alta inicial protegida o un administrador autenticado creando usuarios
    When utiliza una contraseña de cinco caracteres
    Then el servidor rechaza el alta sin crear ninguna cuenta
    When utiliza una contraseña de seis caracteres
    Then puede crear la cuenta e iniciar sesión con ella
    And las cuentas existentes con contraseñas largas siguen funcionando sin cambios
    And los administradores conservan el permiso de crear cuentas desde el panel

  Scenario: Panel compacto sin perder interacción
    Given un administrador abre el panel en escritorio
    Then los controles miden entre 34 y 36 píxeles de alto y las tarjetas tienen rellenos compactos
    And el título principal mide 24 píxeles y los títulos de tarjeta 16 píxeles
    When utiliza el panel en un móvil
    Then los objetivos de pulsación mantienen al menos 44 píxeles de alto
    And no hay desbordamiento horizontal ni se pierde el foco o las funciones de guardar y cancelar

  Scenario: Un borrador ya creado no pide volver a guardar su nombre
    Given un administrador crea o abre un borrador
    Then ve el nombre guardado como título y la opción Cambiar nombre
    And no se muestra un campo de nombre ni un botón Guardar nombre permanente

  Scenario: Edición explícita y cancelación sin escritura
    Given un borrador guardado con nombre Reparto del martes
    When el administrador pulsa Cambiar nombre
    Then se enfoca el campo con el nombre actual y aparecen Guardar cambios y Cancelar
    When cambia el texto y pulsa Cancelar o Escape
    Then permanece el nombre original y el foco vuelve a Cambiar nombre
    And no se envía ninguna escritura ni aumenta la versión

  Scenario: Guardar nombre conserva el borrador y cierra la edición
    Given un administrador abrió Cambiar nombre y escribió un nombre diferente
    When pulsa Guardar cambios o Enter
    Then se actualizan el título y la lista de borradores con el mismo ID y fecha
    And el editor se cierra sólo después del éxito
    And el cambio queda persistido y auditado una sola vez

  Scenario: Conflicto de edición conserva el texto sin sobrescribir
    Given otra sesión ya actualizó la versión del borrador
    When un administrador guarda un nombre desde la versión anterior
    Then recibe un conflicto real y permanece abierto el editor con su texto
    And puede cancelar y volver a abrir la versión actualizada

  Scenario: Cambiar de borrador no traslada la edición pendiente
    Given un administrador está editando el nombre de un borrador
    When abre otro borrador sin guardar
    Then el editor está cerrado y muestra el título del borrador seleccionado
    And no se envía ninguna escritura del texto descartado

  Scenario: Promoción del mismo artefacto entre instalaciones
    Given dos EasyPanel independientes con sus propias variables y bases de datos
    When se inicia la misma versión de Ana Rutas en cada uno
    Then cada panel usa exclusivamente las cuentas y conexiones de su instalación
    And no se modifica ninguna configuración de vendedores, precios ni V3

  Scenario: Alta inicial protegida
    Given una instalación sin usuarios y con secreto de bootstrap
    When dos personas intentan crear simultáneamente la primera cuenta con el secreto válido
    Then sólo una cuenta se crea y queda auditada
    And ningún visitante puede repetir el alta pública

  Scenario: Trabajo simultáneo
    Given dos sesiones válidas del panel
    When ambas actualizan el mismo borrador usando la misma versión
    Then se acepta una actualización
    And la otra recibe conflicto sin sobrescribirla

  Scenario: Revocación
    Given un administrador tiene varias sesiones abiertas
    When otro administrador desactiva su cuenta
    Then sus siguientes solicitudes son rechazadas en todas las sesiones

  Scenario: Conector Odoo privado sin pantalla de configuración
    Given credenciales y empresa configuradas en el servicio de esta instalación
    When el backend necesita consultar Odoo para una operación de rutas
    Then utiliza exclusivamente la configuración privada de ese servicio
    And el panel no muestra una pestaña de conexión, credenciales o separación de entornos
    And no se escriben pedidos, contactos, inventario o precios

  Scenario: Carga real sin simular optimización todavía no conectada
    Given un borrador nuevo
    When el administrador lo abre
    Then puede seleccionar camionetas y cargar surtidos validados desde Odoo
    And no muestra una ruta optimizada hasta recibir un resultado real de Google

  Scenario: Migración aditiva de flota conserva la instalación existente
    Given una instalación propia en esquema v1 con cuentas, sesiones y borradores
    When se aplica concurrentemente la migración de flota
    Then se alcanza una sola vez el esquema v2
    And se conservan sin cambios las cuentas, sesiones, borradores y auditoría anteriores
    And una base ajena o con versión futura se rechaza sin modificarla

  Scenario: Altas y ediciones de flota son idempotentes y versionadas
    Given un administrador autenticado registra una camioneta o un chofer
    When repite la misma solicitud con el mismo identificador
    Then existe un solo registro y un solo evento de alta
    When otra sesión guarda primero una edición de la misma ficha
    Then la versión obsoleta recibe conflicto y no sobrescribe el cambio confirmado

  Scenario: Un chofer sólo puede estar asignado a una camioneta disponible
    Given un chofer activo ya asignado a una camioneta disponible
    When otra sesión intenta asignarlo simultáneamente a otra camioneta
    Then sólo la asignación original permanece y la segunda solicitud recibe conflicto
    And no se puede inactivar al chofer o retirar la disponibilidad de la unidad sin quitar antes la asignación

  Scenario: La tarjeta conserva el estado visible y muestra la foto privada del chofer
    Given una camioneta sin chofer asignado
    When el administrador cambia su disponibilidad desde la tarjeta
    Then el interruptor y el texto visible muestran el mismo estado guardado
    And el estado se conserva al recargar el panel
    When se asigna un chofer con foto privada a la camioneta
    Then la tarjeta muestra la foto del chofer junto a su nombre
    And una camioneta sin chofer o sin foto conserva un indicador visual sin imagen rota

  Scenario: Fotos y licencia permanecen privadas e íntegras
    Given un administrador autenticado carga una imagen raster válida dentro de los límites
    Then se guarda reencodificada sin metadatos y sólo puede leerse con sesión válida
    When se intenta reemplazarla con origen ajeno, versión obsoleta, contenido corrupto o tamaño excesivo
    Then la solicitud se rechaza y los bytes previamente guardados permanecen intactos

  Scenario: Flota persiste y funciona en escritorio, tableta y móvil
    Given una camioneta y un chofer guardados en PostgreSQL propio
    When el proceso se reinicia y el administrador vuelve al panel
    Then las fichas, asignación y documentos continúan disponibles
    And los formularios permiten alta, edición, cancelación y teclado sin desbordamiento horizontal a 375, 940 y 1440 píxeles

  Scenario: La fecha de surtido decide qué pedidos se incorporan
    Given una venta creada antes y un surtido de cliente validado dentro del rango elegido
    When el administrador carga pedidos para un plan con camionetas seleccionadas
    Then se incorpora el surtido por su fecha de validación y no por la creación de la venta
    And la consulta no escribe ventas, entregas, contactos, productos ni precios en Odoo

  Scenario: Varios pedidos del mismo cliente conservan su identidad
    Given un cliente con varios pedidos o surtidos independientes durante el mismo día
    When se cargan al borrador
    Then cada combinación de surtido y pedido aparece por separado con sus propias partidas
    And repetir la carga no duplica tarjetas ni borra asignaciones manuales

  Scenario: Las camionetas del día se eligen antes de cargar
    Given existen camionetas disponibles en la flota
    When el administrador abre Cargar pedidos de Odoo
    Then el modal muestra el número real de camionetas disponibles y permite seleccionarlas
    And las no disponibles permanecen visibles sin poder seleccionarse

  Scenario: Añadir camionetas conserva el trabajo del borrador
    Given el borrador ya tiene pedidos y al menos una camioneta seleccionada
    When el administrador pulsa Añadir camioneta y elige otra unidad disponible
    Then aparece un carril adicional sin volver a consultar Odoo
    And ninguna camioneta, asignación ni orden existente se elimina
    And la operación guarda versión y auditoría de forma atómica
    And una segunda sesión con versión obsoleta recibe conflicto antes de modificar el plan

  Scenario: No quedan camionetas elegibles para el plan
    Given todas las camionetas registradas ya están en el borrador o no están disponibles
    When el administrador abre Añadir camioneta
    Then el modal explica que no hay camionetas disponibles para agregar
    And no permite confirmar una selección vacía

  Scenario: Cambios manuales permanecen seguros entre administradores
    Given un pedido cargado y camionetas seleccionadas para el día
    When se arrastra o selecciona otra camioneta desde una versión vigente
    Then se guardan la asignación y el orden en PostgreSQL con auditoría
    And una versión obsoleta recibe conflicto y debe actualizar antes de decidir nuevamente

  Scenario: Ventanas y prioridad todavía no entregadas
    Given el cliente aún no tiene importada su ventana o preferencia alta
    Then su tarjeta cerrada muestra Sin horario y Prioridad pendiente
    And ningún proceso inventa un horario o una prioridad predeterminada

  Scenario: La IA arma y distribuye la ruta con datos reales de Google
    Given pedidos cargados, camionetas del día, punto de salida y Google Route Optimization configurado
    When el administrador pulsa Armar ruta con IA
    Then Google asigna los pedidos a las camionetas y ordena sus paradas usando la red vial real
    And el resultado guarda su versión, métricas y pedidos no asignables para revisión
    And el administrador puede mover pedidos manualmente después de la propuesta

  Scenario: Siete camionetas y muchos pedidos ocupan el espacio del planificador
    Given un plan con siete camionetas y veinticinco pedidos
    When el administrador cierra el menú con el botón de tres líneas
    Then el tablero usa todo el ancho disponible
    And crear un borrador abre un modal en vez de reservar una franja permanente
    And a 768 píxeles de alto se ven al menos seis pedidos completos
    And la tarjeta cerrada sólo muestra parada, cliente, pedido, partidas, horario y prioridad
    And dirección, surtido, productos, notas y controles aparecen al expandir la tarjeta
    And ninguna tarjeta cerrada supera 80 píxeles de alto
    And cada lista permite bajar sus pedidos sin desplazar el documento en escritorio
    And las camionetas restantes son accesibles por desplazamiento horizontal

  Scenario: Mapa pendiente de configurar
    Given Google Maps todavía no está configurado
    When el administrador pulsa Ver mapa de rutas
    Then un modal informa Mapa pendiente de activar sin coordenadas inventadas
    And Escape cierra el modal y devuelve el foco al botón

  Scenario: Nota de producto procedente de Odoo Studio
    Given existe un único campo de texto Nota para picker en sale.order.line
    When se carga un surtido cuyo producto tiene esa nota
    Then se conserva en la misma partida y se muestra debajo del producto como texto
    And no se ejecuta HTML contenido en la nota

  Scenario: Campo de nota ambiguo
    Given Odoo devuelve dos campos de texto rotulados Nota para picker
    When se intenta cargar un lote
    Then se informa la ambigüedad sin escoger una columna arbitraria
    And los lotes anteriores permanecen guardados
