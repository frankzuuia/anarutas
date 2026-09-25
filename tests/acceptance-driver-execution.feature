Feature: Mapa Five, llegada verificable y repunte de la ruta propia
  Background:
    Given cada chofer sólo accede a sus publicaciones vigentes con su sesión móvil
    And el radio, precisión y antigüedad GPS se consultan del servidor

  @ML01 @ML20
  Scenario: Iniciar o migrar una ruta sin inventar llegadas
    When se confirma el inicio con las fotos válidas del día
    Then se crea una ejecución y sus paradas en el mismo orden publicado
    And un inicio repetido o una migración repetida no duplica la ejecución
    And la APK abre el mapa una sola vez

  @ML02 @ML12
  Scenario: Reabrir, rotar o seleccionar una parada
    Given hay visitas contiguas del mismo cliente y clientes distintos en un mismo punto
    When el chofer consulta las paradas y elige un destino
    Then se agrupa sólo la misma visita y se distinguen las demás
    And seleccionar, rotar o refrescar no cambia pedidos ni registra llegadas
    And no se solicita otra guía para el mismo destino ya activo

  @ML02
  Scenario: Plegar la ficha para usar todo el mapa
    When el chofer desliza abajo la cabecera de la ficha o la toca
    Then el mapa recupera el espacio de la ficha y conserva ruta y guía
    And puede expandirla otra vez sin perder la parada seleccionada

  @ML02
  Scenario: Consultar un marcador sin redirigir la navegación
    When el chofer toca el marcador de otra parada
    Then ve solamente los pedidos de esa parada
    And si comparten parada elige uno y ve sólo sus productos
    And la guía vigente y el orden de la ruta permanecen iguales

  @ML02
  Scenario: Silenciar la voz de la guía
    When el chofer silencia la voz en la ficha abierta o plegada
    Then los avisos hablados se desactivan sin detener la navegación
    And al reabrir la app sigue silenciada hasta que el chofer la reactive

  @ML03 @ML04
  Scenario: Oscilación breve del GPS en el radio de llegada
    Given una muestra real y válida para la parada actual
    When la siguiente muestra empeora brevemente su precisión
    Then Llegué no parpadea por ese jitter y conserva como máximo tres segundos la muestra válida
    But no se reutiliza para otro destino ni después de superar la edad permitida
    And GPS simulado o proveedor desactivado impiden confirmar

  @ML03 @ML04 @ML08
  Scenario Outline: Presencia comprobable antes de confirmar
    Given una muestra GPS <condicion>
    When se intenta Llegué o se confirma un pin nuevo
    Then el servidor <resultado>
    Examples:
      | condicion                                  | resultado                     |
      | real, reciente y precisa dentro del radio   | registra el comando           |
      | simulada                                   | rechaza sin guardar un evento |
      | más vieja que la política                  | rechaza sin guardar un evento |
      | con fecha futura                           | rechaza sin guardar un evento |
      | cuya incertidumbre excede el radio          | rechaza sin guardar un evento |
      | ausente o de coordenadas inválidas          | rechaza sin guardar un evento |

  @ML05
  Scenario: Dos toques o respuesta perdida
    When se envía simultáneamente el mismo comando de llegada
    Then existe una sola llegada con una sola hora
    And el reintento autorizado recupera el recibo aunque su GPS original ya sea viejo
    But la misma clave con otro cuerpo se rechaza

  @ML06
  Scenario: Otro chofer o sesión retirada intenta cambiar la ruta
    When se usa un plan, ejecución o parada ajenos o un token revocado
    Then no se devuelven hechos privados ni se modifican cliente, parada, recibo o incidente

  @ML07 @ML08 @ML13
  Scenario: Corregir el domicilio real desde Mal punteado
    Given el pin antiguo es incorrecto y el GPS válido está cerca del pin nuevo
    When el chofer confirma el punto
    Then una transacción actualiza su ejecución y la ubicación permanente del cliente
    And guarda historial con autor chofer e incidencia de repunte
    And conserva los snapshots y puntos de las otras camionetas
    And no escribe en Odoo ni encola recálculos de flota
    And la sincronización posterior de clientes no borra la ubicación local

  @ML07
  Scenario: Dirección confirmada al corregir el pin
    Given el domicilio escrito del cliente ya no corresponde al punto correcto
    When el chofer confirma el pin y captura calle y número, colonia, código postal y ciudad en el modal
    And confirma el domicilio nuevo
    Then una transacción actualiza coordenadas y dirección de entrega del cliente
    And la ficha de la parada y el pedido propio muestran sólo la nueva dirección
    And el panel Clientes y horarios e Incidencias muestran la corrección sin recargar
    And el historial conserva dirección anterior y nueva con el chofer autor
    And Odoo y los snapshots de otras camionetas no se modifican

  @ML07
  Scenario: No confirmar mientras se arrastra el pin
    When el chofer está moviendo el marcador del domicilio correcto
    Then Confirmar punto permanece inactivo hasta que suelta el marcador
    And sólo se habilita con dirección confirmada y GPS válido para el nuevo punto

  @ML07
  Scenario: Cerrar el modal de domicilio
    When el chofer confirma el pin pero cierra el modal sin confirmar los cuatro campos
    Then no se modifica ni la coordenada ni el domicilio en el servidor
    And puede reabrirlo para completar el domicilio correcto

  @ML05 @ML19
  Scenario: Error o respuesta ambigua al guardar el domicilio corregido
    When el chofer completa los cuatro campos y confirma el domicilio
    And el servidor rechaza el comando o se pierde la respuesta
    Then el modal conserva el texto capturado y muestra el estado real
    And si la respuesta es ambigua permite verificar el mismo comando pendiente
    And sólo se cierra cuando la app vuelve a leer el punto confirmado

  @ML07
  Scenario: Compatibilidad de la APK anterior
    When una APK previa omite el campo estructurado de domicilio
    Then conserva su contrato previo y no inventa otro domicilio textual

  @ML07
  Scenario: Falla de base de datos después de actualizar el cliente
    When la escritura del evento falla antes de confirmar la transacción
    Then se revierten punto, cliente, revisión, historial y recibo

  @ML09 @ML21
  Scenario: Cambio concurrente del cliente, parada o política
    When dos actores guardan basándose en la misma versión
    Then sólo una corrección de cliente se acepta
    And el resto debe recargar y confirmar la versión vigente
    And una política cambiada no permite confirmar con sus valores anteriores

  @ML07 @ML09
  Scenario: Maestro del cliente distinto de la parada publicada
    Given otro chofer corrigió sólo la latitud o sólo la longitud del cliente
    When el chofer confirma el punto de su propia ejecución
    Then se comparan ambas coordenadas de la parada y del cliente
    And sólo es una operación sin cambios si ambas parejas coinciden
    And el evento conserva tanto el punto anterior de la parada como el del cliente

  @ML06 @ML09 @ML21
  Scenario: Guardas protegidas hasta confirmar la transacción
    When una llegada validada está escribiendo su evento
    Then acceso, publicación, ejecución, política y clave de comando permanecen bloqueados
    And revocación, otro escritor o cambio de política no se intercalan entre validación y commit

  @ML10 @ML11 @ML22
  Scenario: Cancelación simultánea y publicación posterior
    When administración retira la ruta mientras el chofer confirma
    Then el comando anterior confirmado conserva su evidencia o el posterior se rechaza
    And la app retira la ruta y detiene la guía al conocer la cancelación
    And no se pueden recuperar recibos privados con la publicación retirada
    And una publicación posterior usa otra ejecución sin llegadas heredadas
    And borrar el borrador no elimina los eventos históricos

  @ML14
  Scenario: Repunte después de una llegada
    When se corrige un punto que ya tiene llegada
    Then la hora y coordenadas históricas del evento anterior permanecen intactas
    And la guía siguiente utiliza el nuevo punto confirmado

  @ML15 @ML16
  Scenario Outline: Retraso real contra ventanas publicadas
    When una llegada ocurre <momento>
    Then <resultado>
    Examples:
      | momento                                  | resultado                          |
      | exactamente al último cierre             | no se crea incidencia de retraso   |
      | con una ventana posterior disponible     | no se crea incidencia de retraso   |
      | sin ventanas publicadas                  | se registra llegada sin pronóstico |
      | después del último cierre                | se guarda el retraso real          |
      | después de medianoche en la zona local   | se filtra por la fecha del evento  |

  @ML17 @ML18 @ML22
  Scenario: Incidencias combinando fechas y chofer con actualización en vivo
    Given administración seleccionó fechas y un chofer
    When llega un evento o se restablece el canal
    Then sólo aparecen los incidentes correspondientes sin perder los filtros
    And una respuesta atrasada no reemplaza el filtro nuevo
    And la paginación conserva eventos con igual milisegundo y distinto microsegundo
    And el chofer inactivo con historial sigue consultable

  @ML19
  Scenario: Fallo de red tras confirmar el punto
    When el servidor guarda el repunte pero falla su lectura posterior
    Then la app no arranca una guía usando el punto viejo
    And vuelve a leer la ejecución antes de mostrar efectos de confirmación
    And no vuelve a enviar un comando cuya respuesta de éxito ya se recibió

  @ML05 @ML19
  Scenario: Se pierde la respuesta del comando guardado
    When el servidor confirma el punto pero la APK no recibe la respuesta
    Then conserva cifrado el mismo comando pendiente de esa ruta
    And verificar la confirmación recupera su recibo sin generar otro historial

  @ML19
  Scenario: Mapa sin clave o Google rechaza la guía
    When no está disponible la configuración Android o falla el SDK real
    Then se muestra el error sin instrucciones ni trazos simulados
    And reintentar guía no vuelve a guardar una incidencia
    And GPS, filtros y refrescos no disparan cálculos de rutas

  @ML02 @ML19
  Scenario: Google responde después de que el destino cambió
    When llega una respuesta para un punto reemplazado, ruta retirada o pantalla destruida
    Then no se inicia la guía anterior ni se interrumpe una solicitud posterior
    And un cambio de punto solicita revisar y confirmar la guía vigente sin otro recálculo automático

  @ML02 @ML19
  Scenario: Salir de la pantalla y finalizar una llegada
    When el chofer deja el mapa o registra Llegué
    Then se liberan las suscripciones de la pantalla
    And una llegada confirmada abre los productos reales sin marcar entrega completa
    And devoluciones, cobro y evidencia de entrega siguen fuera de este bloque

  @ML23
  Scenario: Aviso previo sin aceptar términos por el chofer
    Given la versión actual del aviso no tiene confirmación guardada
    When el chofer abre la navegación y elige Ahora no o cierra el aviso
    Then puede volver a otras funciones pero no iniciar la guía
    And aceptar el aviso local no sustituye los términos nativos de Google

  @ML23
  Scenario: Confirmación persistente y fallo de almacenamiento
    When el chofer toca Entendido
    Then sólo una escritura local confirmada permite continuar
    And un fallo al guardar muestra error y conserva el bloqueo
    And rotar o reabrir no pide otra confirmación de la misma versión guardada

  @ML23
  Scenario: Licencias completas del SDK instalado
    When se compila la APK y se abre Avisos y licencias sin conexión
    Then se puede consultar el texto original completo extraído del mismo AAR
    And la división visual en bloques no omite líneas ni altera los bytes empaquetados
    And el build falla si el SDK no incluye un archivo de licencia reconocido

  @ML24
  Scenario: Configuración Android separada de producción y Firebase
    Given se autorizó configurar navegación sólo en develop con billing existente
    When se habilitan los servicios Android y se crea una clave dedicada
    Then la clave sólo permite el paquete y certificado inspeccionados y ambos servicios SDK
    And las claves anteriores y el proyecto de notificaciones permanecen sin cambios
    And la clave se guarda con acceso local protegido y excluida de Git

  @ML24
  Scenario Outline: Inyección reproducible de configuración local
    Given la configuración de compilación es <configuracion>
    When Gradle genera BuildConfig
    Then <resultado>
    Examples:
      | configuracion                         | resultado                                         |
      | sin clave explícita ni archivo local  | la navegación sigue no configurada                |
      | archivo local para el mismo servidor  | incorpora la clave sin imprimirla                 |
      | clave explícita vacía y archivo local | la clave explícita vacía tiene prioridad           |
      | clave con caracteres inválidos        | falla antes de generar la APK                     |
      | archivo local para otro servidor      | falla sin reutilizar la clave de otro entorno      |

  @ML24
  Scenario: Facturación ausente o creación de clave incierta
    When falta billing activo o no se confirma la creación de la clave
    Then no se activa facturación sin autorización ni se generan destinos de prueba
    And se consulta el mismo identificador antes de intentar otra creación
