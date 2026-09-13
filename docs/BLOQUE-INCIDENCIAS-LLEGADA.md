# Incidencias — llegada real del chofer

Requisito confirmado por el usuario el 12/09/2026.
El usuario confirmó que aún no se construye la APK: este bloque implementa sólo
la consulta del panel; la captura de llegadas reales queda para el bloque móvil.
No existe todavía aquí una APK, sesión del chofer ni evento persistido de llegada.
No se crea un botón administrativo que suplante ese evento ni datos de muestra.

## BL-063 — consulta del panel actual

Sección lateral Incidencias, selector de plan y búsqueda por cliente/pedido.
Separa Retrasos previstos (datos del último cálculo vigente) de Llegadas reales
(sin fuente conectada todavía; no fingir cero incidencias ni mostrar eventos).
Sólo GET autenticados: /api/plans y /api/plans/:id/incidents. El segundo usa
una transacción REPEATABLE READ con los lectores existentes del plan y cálculo
(SELECT / SELECT FOR SHARE, sin DML) para mantener un snapshot consistente.
Cero mutaciones, recálculos o llamadas facturables.

Una fila por destino, pedidos juntos, cliente, camioneta/chofer, ventanas,
llegada estimada con fecha/zona y retraso previsto. Si el cálculo es obsoleto o
no coincide la versión, no combinar ETA viejas con preferencias nuevas. Si un
destino no tiene cálculo de retraso, mostrar cobertura incompleta, no inventar 0.
Consulta cancelada lógicamente al cambiar selección para evitar datos cruzados.

IN01 menú/selección/refresh; IN02 previsto no es real; IN03 cálculo ausente,
obsoleto o incompleto; IN04 grupo sin duplicar destinos; IN05 error/recuperación;
IN06 móvil/teclado; IN07 lectura no modifica plan. QA: unidad pura, mutación del
modelo de consulta, API existente y E2E con PostgreSQL aislado, sin red fingida.
IN08 edición concurrente de ventanas conserva un snapshot consistente; la siguiente
lectura invalida el cálculo anterior. Evidencia en QA-INCIDENCIAS-PANEL.md.

## Confirmado

- En el punto, el chofer pulsa «Llegué» y empieza a surtir ese pedido.
- Llegada/inicio de surtido NO equivale a entrega finalizada.
- La pestaña Incidencias mostrará el cliente/destino, ventana, llegada real y
  retraso respecto al cierre de recepción.
- Ejemplo comunicado: Kalamar, ventana 10:00–11:30, llegó 12:00 → 30 minutos tarde.
- La llegada estimada por Google debe permanecer diferenciada de la llegada real.
- Una incidencia o ventana incumplida no puede vetar Armar ruta ni quitar pedidos.

## Bloque móvil posterior, no implementado

La APK no existe, confirmado por el usuario. Definir el bloque móvil y su
autenticación antes de conectar un evento a un actor real.
Las tablas route_users y route_drivers actuales no constituyen un contrato de
autenticación de choferes: no asumir que un ID enviado por cliente autoriza escritura.

## Condiciones de aceptación para diseñar al conectar la APK

1. Chofer autenticado y asignado a la ruta/destino; aislamiento entre choferes.
2. Doble toque o reenvío conserva una sola llegada, sin mover su hora original.
3. Ventana utilizada debe conservarse en el evento para que posteriores cambios
   de horarios no alteren incidencias históricas.
4. Definir recepción offline, hora del dispositivo y hora de recepción del servidor
   antes de aceptar timestamps no confiables como prueba de puntualidad.
5. Fecha completa y zona horaria de la instalación, incluyendo cruce de medianoche.
6. Llegada al cierre exacto = cero retraso; llegada posterior = diferencia positiva.
7. Sin ventana no fabricar retraso. Ventanas múltiples requieren regla explícita.
8. Varios pedidos del mismo destino: definir alcance del toque del chofer, sin
   contabilizar como varios arribos un único evento físico inadvertidamente.
9. Entrega completada, tiempo de surtido y evidencia de entrega serán eventos
   distintos; no inferirlos del botón «Llegué».

La consulta del panel está implementada localmente en develop. La captura móvil
y las incidencias reales no están implementadas: no se inventa una fuente de datos
ausente. Sin migraciones, escrituras de negocio, push ni despliegue en este bloque.
