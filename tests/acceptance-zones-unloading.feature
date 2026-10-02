Feature: Zonas de reparto y descarga configurada por cliente
  Scenario: El administrador guarda minutos por visita
    Given un administrador de rutas y un cliente vigente
    When guarda 15 minutos de descarga entre Prioridad y Modalidad
    Then persisten después de recargar y sincronizar los datos fuente de Odoo
    And una escritura con versión anterior se rechaza sin sobrescribir

  Scenario: Clientes cercanos permanecen en su zona
    Given dos camionetas y ocho destinos del oeste y dos del este
    When arma la ruta
    Then cada zona se asigna completa a una camioneta
    And Google recibe la camioneta permitida de cada destino
    And conserva los horarios, prioridades, cobertura y regreso a bodega

  Scenario: Varios pedidos no duplican la descarga
    Given dos pedidos de un cliente con 15 minutos de descarga
    And otro cliente en el mismo punto con 5 minutos de descarga
    When se modela la visita física o se recalcula el recorrido manual
    Then la visita consume 20 minutos y los horarios posteriores los incluyen

  Scenario: Falla el proveedor o devuelve otra zona
    Given las zonas calculadas para el plan
    When Google falla o devuelve un pedido en otra camioneta
    Then la recuperación mide por calles las mismas asignaciones de zona
    And si también falla la medición conserva el borrador sin resultado parcial

  Scenario: Configuración cambia durante cálculo
    Given un cálculo iniciado con los minutos anteriores
    When el administrador modifica la descarga antes de guardar el resultado
    Then la huella de entrada impide aplicar el cálculo anterior
    And las rutas iniciadas conservan sus snapshots e historial

  Scenario: Edición sin autorización
    Given una sesión sin permiso de rutas o un origen ajeno
    When intenta editar los minutos del cliente
    Then se rechaza antes de modificar el cliente
