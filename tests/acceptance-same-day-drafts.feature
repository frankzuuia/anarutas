# language: es
Característica: Borradores y salidas independientes del mismo día
  Cada borrador tiene identidad propia; una nueva salida conserva la anterior.

  Escenario: Crear otro borrador con fecha y nombre repetidos
    Dado un plan del día con trabajo finalizado y tickets recibidos
    Cuando el administrador crea dos borradores con la misma fecha y nombre
    Entonces cada intención genera un UUID distinto y un plan vacío
    Y el plan anterior conserva sus pedidos, publicación, tickets y cierre

  Escenario: Recuperar un reintento sin duplicar ni resucitar
    Dada una creación con commandId del administrador
    Cuando se repite concurrentemente con el mismo contenido
    Entonces se devuelve un solo plan y se registra una sola auditoría
    Pero cambiar fecha o nombre con esa clave causa un conflicto
    Y reintentar después de borrar el plan no lo vuelve a crear

  Escenario: Autorización, validación y atomicidad
    Cuando una cuenta inactiva, liquidadora o inexistente intenta crear o reintentar
    Entonces no se escribe ningún plan ni se devuelve uno autorizado a otro rol
    Y fecha, nombre o clave inválidos se rechazan sin cambios
    Y los nombres con sintaxis SQL se guardan como datos
    Y un fallo real de auditoría revierte plan, solicitud y auditoría juntos
    Y dos administradores con la misma clave mantienen intenciones independientes

  Escenario: Actualizar una instalación existente automáticamente
    Dada una base41 con publicación iniciada y restricción de fecha renombrada
    Cuando dos migradores aplican42 o vuelven a ejecutarlo
    Entonces se conserva todo el contenido anterior y se permiten varias fechas iguales
    Y abortar la migración conserva41, su restricción y todos sus datos

  Escenario: Preparar otra salida mientras la primera sigue abierta
    Dada una ruta iniciada cuyo trabajo no está finalizado
    Cuando se crea y publica otro borrador del día
    Entonces el dashboard conserva la primera ruta activa
    Y rechaza iniciar la segunda aunque la primera ya haya terminado su recorrido GPS

  Escenario: Segunda salida después de la recepción y cierre
    Dado que el liquidador acepta todos los cobros de la primera ruta
    Cuando el chofer finaliza trabajo y carga fotos propias de la nueva publicación
    Entonces puede iniciar la segunda salida del día
    Y la primera permanece finalizada e histórica sin aparecer en ruta en vivo
    Y sus pedidos, fotografías, ejecución y cobros no se mezclan con la nueva salida

  Escenario: Concurrencia, reasignación y cancelación
    Cuando se inician dos publicaciones simultáneas del mismo chofer o camioneta
    Entonces sólo una inicia y se muestra como activa
    Y reasignar la camioneta a otro chofer no libera un trabajo abierto
    Pero cancelar legítimamente la primera publicación permite la siguiente salida
    Y las fotos de la ruta anterior no cuentan para la nueva
