Feature: Centro de control privado con pantallas independientes
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
