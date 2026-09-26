Feature: Atención de pedidos e incidencias de la ruta Five
  Background:
    Given el chofer tiene una ejecución iniciada y autorizada
    And cada pedido conserva un estado independiente de la visita a su parada

  @AI04 @AI08
  Scenario: Rechazar exactamente el pedido seleccionado
    Given la parada contiene dos pedidos y el chofer consulta el segundo
    When abre Registrar incidencia y selecciona Pedido rechazado
    Then el segundo pedido permanece seleccionado
    And enviar el rechazo no cambia el estado ni los productos del primero

  @AI06 @AI14
  Scenario: Recuperar envío confirmado sin conservar su archivo local
    Given el servidor guardó una incidencia con foto pero se perdió la respuesta
    And Android ya no conserva la copia de la fotografía
    When la APK verifica el recibo del comando de su dispositivo y ejecución
    Then recupera la confirmación sin volver a subir la foto ni duplicar el caso
    And otro dispositivo no puede consultar ese recibo

  @AI11
  Scenario: Teléfono operativo vigente sin republicar
    Given el cliente no tiene teléfono operativo y el chofer está atendiendo
    When guarda el número desde la incidencia
    Then se refleja en el cliente administrativo, la ejecución y la ficha general
    And el formulario de incidencia conserva su pedido, nota y fotografía
    And el snapshot publicado y Odoo permanecen intactos

  @AI14
  Scenario: Recuperar una limpieza física fallida
    Given la evidencia cumplió 24 horas y el sistema de archivos impide borrarla
    When alguien intenta descargarla
    Then se deniega el acceso aunque el archivo siga presente
    And el siguiente barrido vuelve a intentar el borrado sin borrar auditoría
    And los archivos ajenos o recientes del volumen no se eliminan

  @AI01 @AI02
  Scenario: Salir hacia otra parada sin atender la llegada anterior
    Given el chofer confirmó Llegué en la parada 1 con GPS válido
    When pulsa Ir a la parada 2
    Then la visita 1 vuelve a abierta sin entregar ni crear incidencia
    And la primera llegada permanece inmutable en auditoría
    And volver a la parada 1 requiere otra muestra GPS válida y una visita nueva

  @AI02a @AI03
  Scenario: Una APK anterior omite la salida de la primera parada
    Given la visita 1 continúa activa
    When el servidor confirma una llegada GPS válida a la parada 2
    Then cierra la visita 1 en la misma transacción y abre la visita 2
    But un GPS inválido para la parada 2 no cambia la visita 1

  @AI01 @AI03
  Scenario: Red incierta o dos toques al salir de una visita
    When la APK reenvía el mismo comando de salida con la misma clave
    Then obtiene el mismo recibo sin duplicar evento ni incrementar otra vez la revisión
    But reutilizar esa clave con otro contenido se rechaza
    And un token ajeno o una publicación revocada no modifica la visita

  @AI04 @AI05 @AI15
  Scenario: Cliente cerrado en una parada con dos pedidos
    Given ambos pedidos están abiertos y el chofer llegó
    When envía una fotografía válida y confirma Cliente cerrado
    Then ambos pedidos quedan pendientes de reintento en una sola incidencia
    And el mapa muestra admiración y el panel muestra foto, chofer y fecha
    But administración no ofrece Resolver para este caso

  @AI06 @AI14
  Scenario: Evidencia cancelada, inválida, vencida o fallo de almacenamiento
    When la foto no se confirma o la escritura falla
    Then no se crea una incidencia parcial ni se bloquea un pedido
    And un reintento conserva la misma clave sin duplicar casos
    But después de 24 horas o de su resolución no se puede leer la foto

  @AI07
  Scenario: Reintentar un cliente cerrado
    Given la parada está pendiente por Cliente cerrado
    When el chofer elige Reintentar pedido sin confirmar una nueva llegada
    Then la incidencia permanece visible como pendiente
    When confirma una nueva llegada GPS válida
    Then sale del feed vivo y puede atender el pedido
    But si abandona otra vez sin atenderlo vuelve a pendiente

  @AI08 @AI09
  Scenario: Pedido rechazado y posterior cambio de opinión
    When el chofer registra mala calidad, llegada tarde u Otro con motivo escrito
    Then sólo ese pedido queda rechazado y no pendiente de reintento
    But conserva la posibilidad de una nueva visita y entrega posterior
    And el historial no confunde el rechazo con una entrega

  @AI10 @AI16
  Scenario: Reprogramar sin fecha ni asignación automática
    Given el chofer atiende un pedido pendiente
    When elige Reprogramar y cancela
    Then no cambia el pedido ni el panel
    When vuelve a elegir Reprogramar, añade una nota opcional y acepta
    Then sólo ese pedido queda cerrado como reprogramado en la ruta actual
    And aparece una incidencia en vivo sin fecha futura ni nuevo plan
    And Resolver por administración muestra esa incidencia resuelta sin reabrir el pedido

  @AI11 @AI12
  Scenario: Guardar teléfono operativo sin tocar Odoo
    Given el cliente no tiene teléfono operativo
    When el chofer añade un número válido a un cliente de su ruta
    Then la ficha administrativa y la lectura móvil muestran el mismo número
    And una sincronización de Odoo no lo revierte
    But otro chofer o un número inválido no pueden sobrescribirlo

  @AI13 @AI17
  Scenario: Panel en vivo, liquidación y conservación de auditoría
    Given dos choferes envían incidencias concurrentemente
    When administración filtra por fecha y chofer o se reconecta
    Then cada tarjeta y métrica conserva su chofer y estado sin mezclarse
    And terminar la navegación no cierra la ruta sin liquidación confirmada
    And cuando un bloque futuro cierre la ruta liquidada el feed la oculta pero la auditoría queda

  @AI18
  Scenario: Paradas no activas visibles sobre el mapa oscuro
    When el chofer selecciona una parada distinta
    Then las demás conservan un contorno legible
    And sólo el destino seleccionado mantiene su destaque lima
    And no se reordena la ruta ni cambia la guía por dibujar marcadores

  @AI19 @AI13
  Scenario: Incidencias en vivo es un módulo independiente
    Given existe un repunte registrado y un pedido rechazado
    When administración abre Incidencias desde el panel lateral
    Then ve el repunte y las reglas de llegada sin los casos operativos
    When abre Incidencias en vivo desde su propia entrada lateral
    Then ve el pedido rechazado, sus métricas y resolución sin repuntes ni reglas de llegada
    And puede filtrar los casos operativos por fecha y chofer
    And los nuevos casos aparecen y la reconexión recupera sus estados sin recargar la página
    And cambiar de pantalla no modifica ni resuelve ninguna incidencia
