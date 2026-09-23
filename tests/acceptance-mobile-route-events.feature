Feature: Entrega automática de ruta al chofer conectado
  Scenario: Publicación confirmada para el chofer
    Given el chofer tiene la APK abierta y una sesión móvil vigente
    When administración publica o revisa su ruta y la transacción confirma
    Then el canal móvil emite un cambio sin datos de pedidos
    And la APK consulta su dashboard y muestra la ruta y un aviso sin pulsar Actualizar

  Scenario: Cambio de otra camioneta o transacción revertida
    Given dos choferes mantienen sus canales móviles abiertos
    When cambia la ruta de uno o una edición se revierte
    Then el otro chofer no recibe el evento de ruta
    And una transacción revertida no altera la ruta visible

  Scenario: Desconexión o revocación
    Given la APK pierde el canal de eventos
    When vuelve a conectarse
    Then relee el dashboard y recupera cualquier publicación perdida
    And la consulta periódica continúa como respaldo
    But una sesión revocada cierra el canal y no revela rutas

  Scenario: APK cerrada
    Given Android detuvo la APK
    When administración publica una ruta
    Then no se afirma que SSE entregue un push en segundo plano
    And la notificación del sistema queda pendiente de configurar Firebase real
