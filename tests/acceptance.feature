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
    And muestra una sola Fecha de validación de pedidos editable con el día local actual por defecto
    And explica que la fecha seleccionada traerá los pedidos validados
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

  Scenario: Quitar una camioneta con pedidos asignados
    Given una camioneta del borrador tiene uno o más pedidos asignados
    When el administrador pulsa su bote rojo y confirma Quitar camioneta
    Then la camioneta se retira únicamente de ese borrador
    And todos sus pedidos pasan a Pedidos sin asignar conservando datos y orden relativo
    And la camioneta permanece registrada en la flota
    And Odoo no recibe escrituras ni se vuelve a consultar
    And la operación guarda versión y auditoría en una sola transacción

  Scenario: Cancelar el retiro de una camioneta
    Given está abierto el modal Quitar camioneta del plan
    When el administrador pulsa Cancelar o Escape
    Then no cambia el borrador ni sus pedidos
    And el foco regresa al bote de la camioneta

  Scenario: Cambios manuales permanecen seguros entre administradores
    Given un pedido cargado y camionetas seleccionadas para el día
    When se arrastra o selecciona otra camioneta desde una versión vigente
    Then se guardan la asignación y el orden en PostgreSQL con auditoría
    And una versión obsoleta recibe conflicto y debe actualizar antes de decidir nuevamente

  Scenario: Ventanas y prioridad todavía no entregadas
    Given el cliente aún no tiene importada su ventana o preferencia alta
    Then su tarjeta cerrada muestra Sin horario y Prioridad pendiente
    And ningún proceso inventa un horario o una prioridad predeterminada

  Scenario: OpenAI arma y Google mide la ruta con datos viales reales
    Given pedidos cargados, camionetas del día, salida y regreso, OpenAI y Google configurados
    When el administrador pulsa Armar ruta
    Then OpenAI propone repartos y Google mide sus calles, ventanas, ETA y regreso real
    And el resultado guarda su versión, métricas y pedidos no asignables para revisión
    And el administrador puede mover pedidos manualmente después de la propuesta

  Scenario: Siete camionetas y muchos pedidos ocupan el espacio del planificador
    Given un plan con siete camionetas y veinticinco pedidos
    When el administrador cierra el menú con el botón de tres líneas
    Then el tablero usa todo el ancho disponible
    And crear un borrador abre un modal en vez de reservar una franja permanente
    And a 768 píxeles de alto se ven al menos seis pedidos completos
    And la tarjeta cerrada sólo muestra parada, cliente, pedido, partidas, horario y prioridad
    And la prioridad Alta usa el distintivo amarillo del directorio de clientes
    And la prioridad Media usa el distintivo azul del directorio de clientes
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

  Scenario: Cargar varios pedidos validados fuera de la fecha
    Given el administrador añadió los folios S00001 y S00003 en la carga manual
    And ambos tienen al menos un surtido validado de cliente en la empresa configurada
    When confirma el lote para el borrador
    Then se incorporan todos sus surtidos elegibles aunque se validaron en otra fecha
    And repetir la carga no duplica tarjetas ni cambia sus asignaciones
    And Odoo no recibe escrituras

  Scenario: Un lote manual inválido no se carga parcialmente
    Given el administrador añadió varios folios manuales
    And uno no existe o no tiene ningún surtido validado elegible
    When confirma el lote
    Then se identifican los folios no disponibles
    And ninguno de los folios del lote se incorpora al borrador

  Scenario: Quitar y recuperar un pedido del ruteo
    Given un pedido de Odoo está cargado y puede estar asignado a una camioneta
    When el administrador pulsa su bote rojo y acepta la confirmación
    Then sólo se elimina la tarjeta de Ana Rutas y se conserva Odoo sin cambios
    And el orden restante se normaliza en una transacción versionada y auditada
    When vuelve a cargar desde Odoo una consulta que contiene ese pedido
    Then la tarjeta puede incorporarse nuevamente sin duplicarse

  Scenario: Cancelar el retiro de un pedido
    Given está abierto el modal para eliminar un pedido del ruteo
    When el administrador pulsa Cancelar o Escape
    Then no cambia el borrador ni aumenta su versión
    And el foco regresa al bote del pedido

  Scenario: La carga por fecha y la carga manual son independientes
    Given el modal muestra camionetas, fecha y folios manuales
    When el administrador pulsa Cargar pedidos
    Then se guarda la selección de camionetas y sólo se consulta la fecha elegida
    And únicamente ese botón muestra Cargando
    When el administrador pulsa Confirmar pedidos
    Then sólo se consultan los folios manuales
    And no se guarda la selección de camionetas ni se ejecuta la carga por fecha
    And no existe un botón separado Guardar camionetas

  Scenario: El mismo pedido puede participar en varios planes
    Given un surtido validado ya está incorporado en otro plan
    When el administrador lo carga por fecha o folio en el plan actual
    Then se incorpora también en el plan actual
    And repetirlo no lo duplica dentro de ese plan
    And moverlo o eliminarlo no modifica su copia en los otros planes

  Scenario: Borrar un plan completo
    Given el administrador abrió un plan con pedidos y camionetas seleccionadas
    When pulsa Borrar plan y confirma con la versión vigente
    Then desaparecen el plan y únicamente sus dependencias locales
    And la flota, los choferes, los usuarios, la auditoría y Odoo se conservan
    And se abre otro plan disponible o el estado vacío

  Scenario: Cancelar o competir con el borrado de un plan
    Given está abierto el modal Borrar plan
    When el administrador pulsa Cancelar, cerrar o Escape
    Then no se elimina ningún dato ni aumenta la versión
    When confirma usando una versión que otra sesión ya modificó
    Then recibe un conflicto y el plan permanece íntegro

  Scenario: Sincronizar todos los contactos sin sobrescribir operación local
    Given Odoo devuelve matrices, sucursales, contactos sin ventas y nombres repetidos
    When el administrador actualiza clientes en varias páginas
    Then cada identidad se guarda por origen e ID Odoo sin filtrar customer_rank
    And una interrupción puede continuar sin duplicar registros
    And alias, teléfono, horarios, prioridad, domicilio, punto y archivo locales permanecen intactos

  Scenario: Configurar una ventana inequívoca de 24 horas
    Given el administrador edita una sucursal
    When selecciona lunes a viernes y captura 11:00 hasta 13:00
    Then Ana Rutas guarda 660 y 780 minutos sin AM ni PM
    And muestra 11:00–13:00 en directorio, tarjeta, mapa y Excel
    And rechaza ventanas invertidas, duplicadas o traslapadas el mismo día

  Scenario: Archivar y restaurar sin alterar Odoo
    Given un cliente tiene horarios, prioridad y punto configurados
    When el administrador confirma Archivar
    Then el cliente aparece en Archivados con la misma identidad y configuración
    And una sincronización no lo reactiva ni duplica
    When confirma Restaurar
    Then vuelve a Activos con su configuración intacta

  Scenario: Confirmar un punto de entrega
    Given Google Maps está configurado y existe un domicilio de entrega
    When Google propone un punto y el administrador lo ajusta y confirma
    Then se guardan coordenadas, referencia, liga regenerada y versión de ubicación
    And el planificador y mapa consumen ese punto por destinatario del pedido
    When cambia el domicilio sin confirmar otro punto
    Then el punto anterior queda invalidado y se muestra Punto por confirmar

  Scenario: Exportar clientes y el plan sin fórmulas ejecutables
    Given existen nombres, teléfonos o notas que comienzan con caracteres de fórmula
    When el administrador exporta clientes o el plan seleccionado
    Then recibe un XLSX con hojas Clientes y Ventanas o Ruta y Partidas
    And las celdas peligrosas se guardan como texto
    And el plan exportado conserva su versión, asignación y orden sin inventar ETA o distancia

  Scenario: Ocultar y reabrir el editor de clientes
    Given el administrador tiene un cliente seleccionado en el directorio
    When oculta el panel sin cambios pendientes
    Then el directorio recupera todo el ancho y no se realiza ninguna escritura
    And buscar o sincronizar no abre automáticamente el editor
    When selecciona cualquier cliente
    Then el editor se abre nuevamente con la versión vigente
    And la interfaz ofrece Exportar Excel pero no Importar Excel

  Scenario: Proteger cambios al ocultar el editor de clientes
    Given el administrador modificó un cliente sin guardar
    When intenta ocultar el panel y cancela la confirmación
    Then el editor permanece abierto con sus cambios
    When vuelve a ocultarlo y confirma el descarte
    Then el panel se oculta y al reabrirlo muestra los datos guardados
    And los controles destructivos son compactos en escritorio y táctiles en móvil

  Scenario: Confirmar el único punto de salida antes de optimizar
    Given la instalación sugiere Calle 5 1106, Colonia Industrial como salida y Google Maps está activo
    When el administrador ubica, ajusta y confirma ese punto
    Then la dirección y coordenadas quedan versionadas y auditadas
    And cada camioneta usará ese punto como salida y regreso, sin capacidad de peso

  Scenario: Una dirección de salida incompleta no genera un punto falso
    Given el administrador escribe una calle sin ciudad, estado o país
    When Google devuelve una coincidencia parcial, una zona o una calle general
    Then Ana Rutas muestra la dirección que Google encontró como referencia y no permite confirmarla directamente
    And solicita completar el domicilio o marcar manualmente la salida exacta antes de guardar

  Scenario: Cambiar el domicilio no conserva una propuesta anterior
    Given Google propuso un punto para la dirección de salida
    When el administrador modifica cualquier parte del domicilio
    Then la propuesta y el mapa anterior se limpian
    And Guardar salida permanece bloqueado hasta ubicar y confirmar el nuevo punto

  Scenario: Optimizar con red vial, ventanas y prioridades reales
    Given un borrador vigente con camionetas, pedidos y puntos confirmados
    When el administrador pulsa Armar ruta
    Then OpenAI propone y compara candidatos medidos por Google considerando calles y ventanas duras
    And las entregas Alta preceden a Media y Por horario y las Media preceden a Por horario
    And Ana Rutas guarda ETA, distancia, duración y polilíneas sin guardar credenciales

  Scenario: Una respuesta externa no pisa un cambio concurrente
    Given Google está calculando una propuesta para una versión del borrador
    When otra sesión modifica esa versión antes de aplicar el resultado
    Then la propuesta recibe conflicto y no cambia ninguna asignación ni posición
    And el administrador puede actualizar y solicitar otra optimización

  Scenario: Un cambio manual recalcula el recorrido sin deshacer el acomodo
    Given el mapa muestra una optimización vigente
    When el administrador mueve un pedido o cambia las camionetas
    Then la propuesta anterior permanece en auditoría mientras se recalculan tramos y ETA
    And el nuevo recorrido conserva vehículo y orden elegidos y regresa a la bodega

  Scenario: Añadir una camioneta a un plan previamente armado
    Given un plan con recorrido vigente y pedidos asignados
    When el administrador añade otra camioneta y mueve pedidos hacia ella
    Then la asignación manual queda guardada y no redistribuye los demás pedidos
    And se recalculan ambas rutas desde la salida hasta el regreso a bodega

  Scenario: La IA no puede degradar la prioridad estricta
    Given existen pedidos Alta, Media y Por horario con puntos y ventanas confirmados
    When OpenAI propone uno o más candidatos y solicita confirmarlos
    Then el servidor rechaza IDs ajenos, omisiones, duplicados y orden de prioridad inverso
    And sólo confirma el candidato vial factible de menor score ya evaluado

  Scenario: Google omite las listas de una camioneta sin entregas
    Given Google propone siete entregas en una camioneta y devuelve otra sin listas de visitas
    When Ana Rutas interpreta la respuesta ProtoJSON
    Then conserva las siete entregas y reconoce la segunda camioneta como vacía
    And OpenAI continúa la evaluación de alternativas sujetas a prioridades y cobertura completa
    And una respuesta con pedidos realmente ausentes se rechaza con diagnóstico del campo

  Scenario: Configurar y auditar el razonamiento del planificador
    Given EasyPanel configura un nivel de razonamiento compatible con el modelo OpenAI
    When el administrador arma una ruta
    Then cada ciclo de Responses API recibe el nivel configurado
    And la auditoría registra modelo y nivel sin exponer la clave privada
    When el nivel configurado no pertenece al contrato oficial admitido
    Then el planificador falla cerrado antes de enviar datos a OpenAI

  Scenario: Mostrar únicamente consumo oficial de Google
    Given Cloud Billing exporta Standard usage cost y Pricing data al dataset configurado
    When el actualizador de Ana Rutas consulta BigQuery
    Then filtra únicamente el proyecto Google Maps de esta instalación
    And muestra uso, cuota, restante, costo bruto, créditos y costo neto de los SKUs publicados
    And registra la hora del último corte de Google y de la tabla de precios
    And no calcula consumo a partir de clics, pedidos o movimientos internos

  Scenario: Acumular por periodo sin duplicar sincronizaciones
    Given Google publicó varios días y meses de uso para el mismo SKU
    When dos réplicas intentan actualizar el control simultáneamente
    Then una sola obtiene el arrendamiento y consulta BigQuery
    And los días forman el histórico y el mes vigente agrega cada movimiento una sola vez
    And la nueva fotografía reemplaza a la anterior en lugar de sumarse sobre ella

  Scenario: Conservar el último corte ante retraso o caída de Google
    Given existe una fotografía oficial guardada
    When BigQuery no responde o devuelve un contrato incompleto
    Then Ana Rutas conserva intacta la última fotografía válida
    And muestra que el dato está atrasado junto con la fecha de su corte
    And no expone credenciales, consultas ni detalles privados del proveedor

  Scenario: No fingir consumo cuando la integración no está configurada
    Given las exportaciones FinOps todavía no están configuradas en EasyPanel
    When el administrador abre Control de consumo
    Then ve los requisitos de integración y no una cifra de cero pesos
    And un visitante sin sesión no puede leer ni solicitar la sincronización
