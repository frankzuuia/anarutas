# language: es
Característica: Espacio del chofer Five Rutas
  El chofer consulta y prepara sólo las rutas publicadas que le autoriza el servidor.

  Escenario: Inicio con accesos funcionales e identidad real
    Dado un chofer autenticado y su dashboard autorizado
    Cuando abre Inicio
    Entonces ve el logo original de Five, su nombre y la fecha del servidor
    Y las tarjetas Ruta activa, Pedidos, Mi unidad y Mis rutas abren su destino
    Y no se muestran entregas, distancias ni progreso inventados

  Escenario: Sin ruta o sin conexión
    Dado que no existe una ruta publicada para hoy
    Cuando el chofer abre Inicio o Ruta
    Entonces ve un estado de espera y no un botón de iniciar habilitado
    Cuando la consulta falla
    Entonces puede reintentar sin perder sus credenciales guardadas

  Escenario: Menú y preferencias locales
    Dado el Inicio autenticado
    Cuando abre el menú lateral y entra a Preferencias
    Entonces puede guardar la preferencia de mantener la pantalla encendida
    Y esa preferencia se aplica sólo con una ruta iniciada y la app visible
    Y Permisos abre los ajustes de Android sin conceder permisos por su cuenta
    Cuando presiona Atrás
    Entonces vuelve al Inicio sin cerrar la sesión

  Esquema del escenario: Preparación de salida protegida
    Dado una ruta de <fecha> con <fotos> fotos, pedidos y recorrido vigente
    Cuando el chofer consulta la ruta
    Entonces el inicio está <estado>
    Ejemplos:
      | fecha  | fotos | estado        |
      | hoy    | 4     | deshabilitado |
      | hoy    | 5     | habilitado    |
      | hoy    | 8     | habilitado    |
      | ayer   | 8     | deshabilitado |
      | mañana | 8     | deshabilitado |

  Escenario: Confirmación antes de iniciar
    Dado una ruta de hoy lista para salir
    Cuando presiona Iniciar ruta
    Entonces ve una confirmación con paradas, pedidos, unidad y métricas
    Y todavía no se registra el inicio
    Cuando elige Todavía no
    Entonces se conserva la ruta sin iniciar
    Cuando confirma una revisión que administración ya cambió
    Entonces la revisión del servidor impide iniciar una versión obsoleta

  Escenario: Fotos cerradas después del inicio
    Dado una ruta iniciada
    Cuando abre Fotos de la unidad
    Entonces puede ver las fotos pero no capturar ni eliminarlas
    Y no ve la política interna de retención

  Escenario: Historial no cambia el acceso al mapa actual
    Dado una ruta de hoy iniciada y una clave de navegación configurada
    Cuando consulta una ruta de otra fecha en Mis rutas
    Entonces el acceso central al mapa sigue apuntando a la ruta de hoy
    Y la ruta histórica sólo admite consulta
    Cuando administración retira la ruta actual y llega la actualización
    Entonces desaparece el acceso a esa ruta y la sesión permanece abierta

  Escenario: Pedidos con búsqueda y detalle real
    Dado los pedidos publicados de una ruta
    Cuando busca por cliente, folio o dirección
    Entonces el filtro ignora mayúsculas y espacios exteriores
    Y no cambia el orden, asignación ni recorrido
    Y una búsqueda sin coincidencias tiene un estado vacío explícito
    Cuando abre una tarjeta
    Entonces ve sus productos, cantidades, domicilio, horario y nota disponibles

  Escenario: Cambio de día sin reutilizar la preparación anterior
    Dado fotos y una ruta cargadas del día anterior
    Cuando el servidor anuncia una fecha de operación distinta
    Entonces se limpia la selección de fotos anterior y se consulta la ruta actual
    Y no se cierra la sesión ni se habilita el inicio con fotos de ayer
