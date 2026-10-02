# language: es
Característica: Iniciar sólo con pedidos validados de la camioneta
  Escenario: Publicar con pendientes sigue permitido pero salir no
    Dado una camioneta publicada con un pedido validado y dos pendientes Odoo
    Y el chofer tiene las fotos, fecha y revisión requeridas
    Cuando confirma Iniciar ruta
    Entonces recibe los folios pendientes y un rechazo 409
    Y no se crea salida ni ejecución

  Escenario: Validación del último pendiente
    Dado una ruta publicada bloqueada por su último pendiente
    Cuando la sincronización existente recibe su validación
    Entonces el chofer recibe la actualización de los pendientes
    Y puede iniciar cumpliendo los requisitos actuales

  Escenario: Pendientes ajenos no bloquean
    Dado que todos los pedidos de la camioneta del chofer están validados
    Y hay pendientes en otra camioneta, sin asignar y en otro plan
    Cuando el chofer inicia su ruta
    Entonces el inicio es aceptado sólo para su camioneta

  Escenario: Concurrencia y recuperación
    Dado que la sincronización mantiene el lock de su plan
    Cuando dos solicitudes de inicio esperan la validación confirmada
    Entonces se crea una sola salida después del commit
    Y el segundo inicio devuelve el recibo existente

  Escenario: Cliente antiguo o lectura atrasada
    Dado que un cliente intenta iniciar con un pedido pendiente
    Cuando envía directamente el POST autenticado
    Entonces el servidor mantiene el bloqueo
    Y una revisión incorrecta o un chofer ajeno conserva su rechazo previo
