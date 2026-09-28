# BL-142 / VH01..VH08. Contratos cubiertos por pruebas Vitest, PostgreSQL y Playwright.
Característica: Ventanas diarias de entrega por cliente
  Como administrador de Ana Rutas
  quiero capturar sólo Desde y Hasta
  para que el mismo horario aplique a cualquier día del plan.

  Escenario: Editar y guardar una ventana
    Dado que abrí un cliente con permisos de administración
    Cuando agrego una ventana Desde 11:00 Hasta 13:00 y guardo
    Entonces no veo selector de días
    Y la lista muestra 11:00–13:00
    Y el pedido del cliente recibe el intervalo 660–780 minutos

  Escenario: Aplicar el mismo horario en domingo
    Dado que el cliente tiene una ventana Desde 09:00 Hasta 12:00
    Cuando consulto sus pedidos en jueves y domingo
    Entonces ambas consultas devuelven el mismo intervalo

  Escenario: Rechazar horas inválidas o traslapadas
    Dado que el cliente conserva su versión vigente
    Cuando intento guardar una hora inválida, un fin anterior, dos ventanas traslapadas o un campo de días antiguo
    Entonces el servidor rechaza la edición sin escritura parcial

  Escenario: Migrar horarios semanales sin recortar disponibilidad
    Dado que existen horarios anteriores repetidos, contiguos y traslapados entre distintos días
    Cuando se ejecuta la migración automática
    Entonces se conservan los originales en el archivo de auditoría
    Y los horarios diarios quedan unidos por cliente y ordenados
    Y los horarios de otros clientes no se mezclan

  Escenario: Migración concurrente y repetida
    Dado que dos instancias comienzan la actualización de esquema
    Cuando ambas solicitan la migración al mismo tiempo
    Entonces sólo queda la versión 26 consistente
    Y ejecutar de nuevo la migración no duplica los registros auditados

  Escenario: Rechazar un esquema anterior incoherente
    Dado que la instalación declara versión 25 pero le faltan la columna de días y la restricción diaria
    Cuando se inicia la migración automática
    Entonces falla sin marcar la instalación como versión 26

  Escenario: Protección de edición y exportación
    Dado que un usuario no autorizado intenta editar horarios
    Cuando solicita la API de clientes
    Entonces la API rechaza la operación y no cambia el cliente
    Y el Excel autorizado exporta sólo Desde, Hasta y orden, sin columna de días
