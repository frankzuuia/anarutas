# AG — alarma global del panel

Autorizado por «Sí, alarma en todo el panel y segundo plano». Develop solamente;
commit/push tras validación, sin deploy. Ampliación adicional autorizada: títulos
de los grupos de incidencias en ámbar claro. No se aplica UI UX Pro Max.

## Autopsia y conexiones

- `useIncidentAlarm` sólo tenía suscriptores en `LiveIncidentsPanel`. Cambiar de
  sección desmontaba la última suscripción, detenía el sonido y el monitoreo.
- `usePanelRealtime` cerraba `/api/events` cuando el documento quedaba oculto.
  Un temporizador de respaldo no garantiza recepción inmediata en segundo plano.
- La notificación de PostgreSQL, el cursor durable, el Visto compartido, el
  límite de duración y la reserva con Web Locks ya existen y se conservan.

## Bloque aprobado

1. La raíz autorizada de Dashboard conserva la suscripción de alarma; las
   pantallas embebidas comparten el almacén sin abrir conexiones adicionales.
2. La misma conexión SSE del panel sigue abierta en segundo plano cuando hay
   audio activado. Reset/change despiertan el lector de alertas; la actualización
   de datos de las pantallas ocultas se difiere hasta volver a primer plano.
3. Cobertura de políticas, mutaciones, integración y Chrome real con otra pestaña
   al frente y la ventana minimizada. Preservar duración, Visto, recuperación,
   deduplicación, aislamiento de rol y cierre de sesión.
4. Color de títulos por tipo y apartados inferiores mediante CSS acotado; sin
   cambiar agrupaciones ni las tarjetas de clientes.

## Contrato y aceptación

- AG01: activar por clic real una vez por documento; cambiar de sección mantiene
  la reproducción actual y las alarmas de incidencias nuevas.
- AG02: con la pestaña oculta, un commit real despierta la alarma mediante SSE;
  no requiere volver a Incidencias en vivo ni refrescar pantallas ocultas.
- AG03: lo mismo con la ventana de Chrome realmente minimizada. No se simula
  `visibilityState` y no se desactiva la política de autoplay.
- AG04: conservar 5/10/15 s y una sola ráfaga entre pestañas del mismo ámbito.
- AG05: Visto compartido detiene la ráfaga cuando ya no quedan pendientes.
- AG06: recuperar novedades después de una desconexión; editar/navegar no repite
  identidades consumidas. Conservar el drenado de lotes de más de 100 eventos.
- AG07: cierre/revocación de sesión detiene el contexto al navegar al login;
  cuentas de liquidación no montan el monitor de incidencias. Recarga/relogin
  comienzan sin activación de audio; el servidor sigue verificando permisos.
- AG08: conservar el modo en pausa de las otras vistas cuando el sonido no está
  activado; una conexión SSE por Dashboard raíz.
- AG09: títulos por tipo y apartados inferiores en ámbar claro, diferenciados
  del nombre del cliente, sin cambiar el tamaño compacto.
- AG10: petición adicional «las llegadas tarde que no entren en la alarma»:
  excluir sólo `late_arrival` de las filas sonoras y de la reconciliación de
  ráfagas. Conservar su notificación durable, tarjeta roja y Visto; consumir el
  cursor incluso en lotes silenciosos y mantener sonoras las otras incidencias.

## Límites verificables

Una página congelada/descartada, navegador cerrado, equipo en reposo o salida
silenciada no ofrece un sonido inmediato garantizado. No se introducen audio
silencioso permanente, bypass de autoplay, permisos de notificación, workers ni
servicios externos. Una sesión activa y un contexto de audio operativo son
necesarios. Fuentes oficiales:

- https://developer.chrome.com/blog/autoplay
- https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api

La prueba de audio observará nodos/análisis Web Audio nativos; no reemplazará
respuestas de API, conexión SSE, PostgreSQL, permisos ni estados del documento.
