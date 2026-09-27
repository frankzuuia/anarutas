Feature: Centro de control privado con pantallas independientes
  Scenario: Canal vivo mantiene semántica después de cambios y fallos
    Given el administrador tiene una conexión SSE a PostgreSQL real
    When llega un cambio autorizado seguido de un periodo sin cambios
    Then recibe un cambio y después un latido, sin repetir el cambio
    When la conexión PG hereda un canal ajeno o LISTEN falla
    Then ignora el canal ajeno y puede reconectar tras el fallo
    And sólo una sesión vencida recibe el evento de expiración
    When se cierra la conexión mientras la autenticación espera un bloqueo de base de datos
    Then se liberan la suscripción y los temporizadores sin dejar latidos huérfanos
    And una conexión posterior puede enviar latidos normalmente

  Scenario: Barra compacta conserva controles y gana altura operativa
    Given el administrador abrió Centro de control en un monitor de escritorio
    When el título, estado de guardado, Agregar pantalla y Actualizar son visibles
    Then comparten una sola barra y las tarjetas comienzan más arriba
    When pulsa Actualizar
    Then se vuelven a consultar la ruta y las incidencias vivas sin perder filtros
    When agrega una pantalla y recarga la página
    Then la distribución guardada y el foco del selector siguen funcionando
    And en una ventana estrecha todos los controles son accesibles sin desbordar

  Scenario: Dos mapas del mismo tipo para choferes distintos
    Given dos choferes tienen rutas iniciadas y el administrador tiene sesión válida
    When agrega dos pantallas Ruta en vivo y elige un chofer diferente en cada una
    Then cada pantalla muestra sólo la ruta y el avance del chofer elegido
    And recargar conserva la distribución y filtros por usuario

  Scenario: Pantallas administrativas conservan sus contratos
    When agrega Clientes y horarios, Planificar rutas e Incidencias en vivo
    Then se usan los mismos componentes y permisos del panel original
    And expandir o reducir no reinicia el formulario ni cambia filtros
    And quitar una pantalla no elimina pedidos, clientes o incidencias

  Scenario: Dos incidencias visibles en una pantalla dividida
    Given hay dos incidencias reales de rutas iniciadas vigentes
    When el administrador abre Incidencias en vivo en Centro de control
    Then el filtro por chofer permanece y no aparece un selector de fechas
    And las dos fichas se ven como resúmenes dentro de la pantalla
    When abre Detalles y acciones de un caso
    Then puede consultar la evidencia y resolver cuando el caso lo permita

  Scenario: Cuatro pantallas completas en un monitor de escritorio
    Given el administrador tiene cuatro pantallas en el Centro de control
    When abre el tablero a 1500 por 800 o 1366 por 768 píxeles
    Then ve las cuatro tarjetas completas en una cuadrícula de dos por dos sin desplazar la página
    And el contenido extenso se desplaza dentro de su tarjeta sin ocultar las demás
    When agrega una quinta pantalla
    Then el tablero se desplaza internamente sin reducir más las cuatro primeras

  Scenario: Incidencia de ayer sigue en vivo mientras la ruta está vigente
    Given un chofer registró una incidencia ayer en una ruta iniciada vigente
    When el administrador consulta Incidencias en vivo sin fechas
    Then el caso y las métricas lo incluyen
    When se cancela la publicación de esa ruta
    Then el caso deja la vista viva y permanece en la auditoría
    And la pantalla histórica Incidencias conserva sus filtros de fecha

  Scenario: Pérdida de GPS o red
    Given existe una ubicación real recibida
    When dejan de llegar muestras recientes o la app detiene el servicio
    Then se muestra la última ubicación con antigüedad y sin etiqueta GPS vigente
    And una reconexión no reproduce ubicaciones históricas como actuales

  Scenario: Destino y avance canónicos
    When el chofer consulta otro pedido sin pulsar Ir
    Then el destino del centro no cambia
    When confirma Ir a esa parada
    Then se actualiza el destino pero no se registra llegada o entrega
    When una entrega se completa o se reprograma
    Then sus marcadores terminales desaparecen y la lista conserva su estado

  Scenario: Seguridad y concurrencia
    Then otra cuenta móvil no puede enviar GPS por ese chofer
    And una sesión revocada no puede publicar ubicación
    And un mensaje atrasado no reemplaza el estado nuevo
    And guardar una distribución con versión obsoleta no pisa la actual

  Scenario: Seguimiento foreground Android
    Given el chofer abrió una ejecución vigente con permiso de ubicación
    When minimiza la app
    Then la notificación identifica el seguimiento activo
    And detener seguimiento o cerrar sesión termina la captura
    And sin permiso o proceso terminado se informa la falta de ubicación

  Scenario: Cuatro mapas completos con un único filtro por chofer
    Given hay cuatro pantallas de Ruta en vivo y una preferencia antigua de camioneta
    When el administrador abre el centro en 1500x800 o 1366x768
    Then el mapa ocupa al menos el 70 por ciento de cada tarjeta sin recortarse por scroll
    And sólo aparece el selector de chofer y la camioneta antigua no oculta rutas
    And los controles tienen fondo sólido incluso deshabilitados
    When abre Ver avance con teclado y cierra con Escape
    Then consulta las paradas sin cambiar el tamaño del mapa y recupera el foco
    And ampliar y reducir preserva el chofer seleccionado

  Scenario: Primera ubicación remota posterior a la apertura
    Given el mapa está abierto sin GPS recibido
    When llega la primera ubicación válida de la APK con seguimiento
    Then el encuadre incluye una camioneta sin nombre visible y con identificación accesible
    And las muestras posteriores conservan la cámara salvo seguimiento elegido
    And sin GPS no se coloca una camioneta en la dirección de un pedido
