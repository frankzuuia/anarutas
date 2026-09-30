Feature: Fuente financiera automática sin alterar la operación
  Scenario: LQ01 LQ03 LQ04 - Importación y seguimiento por identidad
    Given un pedido de Odoo importado en uno o varios planes
    When el servidor consulta su picking y orden por ID aunque cambie el día
    Then existe un único seguimiento financiero independiente del rango del selector
    And un pendiente conserva valores provisionales sin total cobrable
    And una entrega validada y conciliada conserva importes oficiales y moneda

  Scenario: LQ02 LQ12 - Validación posterior y lectura concurrente
    Given una revisión pendiente conservada
    When Odoo valida la entrega o modifica sus cantidades e importes
    Then una lectura coherente produce una revisión nueva sin republicar la ruta
    But si las dos lecturas completas difieren no se publica una mezcla de datos

  Scenario: LQ05 LQ06 LQ07 - Identidad y valoración no demostrable
    Given productos repetidos, varios movimientos, unidades diferentes o un backorder
    When se concilia la entrega con todas las líneas y movimientos relacionados de su orden
    Then se usa movimiento y línea de venta y nunca nombre o posición
    And sólo la correspondencia completa permite asignar el total de la orden
    And las diferencias de unidad, moneda, producto, devolución o cantidad quedan en revisión
    And no se inventa precio cero, conversión, impuesto ni total de una entrega parcial

  Scenario: LQ08 - Redondeo real y diferencias arbitrarias
    Given importes oficiales redondeados por partida y un total distinto en la orden
    When el cálculo decimal de cantidades, precios y descuentos sin impuestos demuestra redondeo global
    Then se conservan ambos importes y la diferencia exacta
    But una diferencia no demostrada bloquea el total de entrega

  Scenario: LQ09 - Falla del proveedor y recuperación
    Given una revisión financiera ya confirmada
    When Odoo falla o devuelve 429 con Retry-After
    Then la revisión permanece intacta con edad, error y próximo intento consultables
    And el enfriamiento compartido impide nuevas consultas durante la espera
    And el siguiente éxito elimina el error sin duplicar una revisión idéntica

  Scenario: LQ10 - Exclusión, reinicio e idempotencia
    Given dos workers sobre la misma fuente
    When intentan sincronizar a la vez o el primero pierde su conexión PostgreSQL
    Then sólo el titular del bloqueo conserva autorización de escritura
    And el bloqueo abandonado se libera automáticamente
    And un resultado repetido conserva la misma revisión y una transacción fallida no deja escrituras parciales

  Scenario: LQ11 - Conservación de rutas iniciadas
    Given una publicación iniciada con ejecución e incidencias operativas
    When cambia una revisión financiera
    Then los snapshots operativos, recorrido, visitas, recibos y guardas permanecen intactos
    And la nueva fuente todavía no se proyecta a Android antes del bloque de precios e incidencias

  Scenario: LQ13 - Aislamiento de origen y autorización
    Given una instalación ligada a una fuente y un administrador activo
    When otra fuente, empresa, usuario inactivo o identidad ajena solicita datos
    Then el servidor rechaza el acceso sin ampliar el conector ni exponer credenciales

  Scenario: LQ14 - Migración, conservación y reversión transaccional
    Given una base real con schema33 y pedidos existentes
    When se aplica la migración34 repetidamente
    Then crea seguimiento aditivo sin alterar pedidos ni publicaciones
    And el historial financiero permanece inmutable aunque se archive el plan
    And cualquier error revierte la transacción completa
