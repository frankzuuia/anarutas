Feature: Publicación e inicio de rutas por camioneta
  Scenario: Borrador privado hasta publicación
    Given un plan calculado pero sin publicación
    When el chofer consulta Inicio y sus planes
    Then no recibe pedidos, trazo ni métricas de ese borrador

  Scenario: Publicar una unidad sin duplicar el plan
    Given una camioneta activa con chofer vigente y recorrido calculado
    When el administrador confirma Activar ruta para esa camioneta
    Then sólo ese chofer ve un snapshot de su ruta
    And la publicación queda auditada sin crear otro plan ni solicitar Google Routes

  Scenario: Republicar cambios de una unidad no iniciada
    Given una ruta publicada que el chofer aún no inició
    When el administrador cambia pedidos y confirma Guardar y publicar
    Then el chofer ve la nueva revisión de su camioneta
    And no se crea una segunda publicación para el mismo plan y camioneta

  Scenario: Publicación global atómica
    Given varias camionetas con pedidos y una de ellas sin recorrido vigente
    When el administrador confirma Publicar rutas
    Then ninguna camioneta cambia su publicación
    And se informa cuál precondición impidió publicar

  Scenario: Cinco fotos distintas habilitan inicio
    Given una ruta publicada para hoy con volumen privado disponible
    When el chofer sube cinco fotos válidas de su unidad
    Then las imágenes se almacenan en WebP fuera de PostgreSQL
    And puede iniciar una sola vez con hora del servidor

  Scenario: Fotos insuficientes o demasiadas
    Given una ruta publicada con menos de cinco fotos distintas
    When el chofer intenta iniciar
    Then el servidor rechaza el inicio sin alterar la publicación
    Given la misma ruta ya tiene ocho fotos
    When el chofer intenta subir una novena
    Then el servidor rechaza la captura sin contarla

  Scenario: Fotos de otro día no habilitan el inicio
    Given una ruta publicada para una fecha local y fotos anteriores de esa unidad
    When el chofer consulta el conteo o intenta iniciar
    Then sólo se cuentan las fotos capturadas durante la fecha local de servicio
    And una carga fuera de esa fecha se rechaza sin dejar archivo accesible

  Scenario: Chofer ajeno no puede ver evidencia
    Given una foto privada de otra camioneta
    When un chofer autenticado adivina su identificador
    Then la lectura responde como no encontrada sin revelar su contenido

  Scenario: Un relevo no hereda las fotos del chofer anterior
    Given una ruta publicada aún no iniciada con fotos del chofer original
    When la unidad y publicación se reasignan a un relevo
    Then el relevo ve cero fotos propias y no puede iniciar con las anteriores
    And ninguno de los dos choferes puede leer fotos fuera de su asignación vigente

  Scenario: Una camioneta iniciada queda congelada
    Given una camioneta iniciada y otra sin iniciar en el mismo plan
    When administración edita la camioneta sin iniciar
    Then esa camioneta puede recalcularse y republicarse
    But no puede mover pedidos ni cambiar el responsable de la ruta iniciada
    And tampoco puede borrar el plan completo

  Scenario: Asignación persistente de flota con relevo para rutas futuras
    Given un chofer con una ruta iniciada en su camioneta
    When administración lo quita de la camioneta y asigna a otro chofer libre
    Then la ruta iniciada y sus fotos siguen accesibles sólo al chofer original
    And el chofer nuevo queda asignado de forma persistente a la camioneta para planes futuros
    But no recibe automáticamente los pedidos de la ruta ya iniciada

  Scenario: Publicación rechaza chofer o unidad no elegible
    Given un recorrido calculado para una camioneta
    When la camioneta queda sin chofer, no disponible o con chofer inactivo
    Then la publicación responde conflicto y no crea ni altera el snapshot

  Scenario: Publicación rechaza paradas ajenas o incompletas
    Given un recorrido calculado cuya secuencia no coincide exactamente con los pedidos de la camioneta
    When administración intenta publicar
    Then la publicación responde conflicto y no crea ni altera el snapshot

  Scenario: Caducidad de evidencia
    Given fotos de una unidad cuyo plazo de quince días venció
    When corre el worker de retención
    Then dejan de ser accesibles y se eliminan sus archivos privados

  Scenario: Control de unidades conserva el nombre publicado de la ruta
    Given fotos capturadas para una ruta publicada
    When administración cambia el nombre del borrador sin republicarlo
    Then la galería de la camioneta agrupa las fotos bajo el nombre publicado y la fecha de esa ruta

  Scenario: Navegación explícita sin solicitar destinos al abrir mapa
    Given un chofer con ruta iniciada, GPS y clave Android configurados
    When abre el acceso Mapa desde la barra inferior
    Then ve la parada publicada y el trazo calculado en el mapa real, si existe
    And abrir el mapa no llama setDestinations todavía
    When pulsa Iniciar guía
    Then el SDK solicita el siguiente bloque de hasta veinticinco destinos
    And las indicaciones de giro provienen del SDK, no de texto simulado

  Scenario: Salida y regreso al mapa
    Given una guía activa a una parada intermedia
    When el chofer cambia de pantalla y vuelve al mapa
    Then conserva el índice y bloque de destinos de la revisión publicada
    And abrir la vista no solicita de nuevo el recorrido

  Scenario: GPS denegado o punto incompleto
    Given una ruta iniciada sin permiso GPS o con coordenadas faltantes
    When el chofer abre el mapa
    Then ve un error accionable y no recibe un giro inventado

  Scenario: Consulta administrativa por fecha
    Given fotos vigentes de distintas camionetas y fechas
    When administración abre Control de unidades y filtra una fecha
    Then ve sólo la evidencia privada de la camioneta y fecha elegidas
