# Tarjetas compactas y continuidad del sonido

Bloque aprobado por el propietario: «Sí, tarjetas y alarma». Sólo develop;
commit/push tras verificaciones, sin deploy. No usar ui-ux-pro-max.

Autopsia: IncidentCard abre los detalles en la página normal (`open={!compact}`)
y el estilo compartido apila encabezado, cliente, pedido, producto y acciones.
El coordinador vuelve a `enabled: false` al desmontar su último consumidor.
Además, parar una ráfaga deja su reserva local vigente: volver antes de su
vencimiento puede consumir otra novedad sin emitir audio. La captura muestra
«Activar sonido»; no demuestra un fallo del servicio de notificaciones.

## Contrato y escenarios

| Caso | Resultado verificable |
| --- | --- |
| TA01 Tarjeta normal/embebida | Resumen compacto; dirección/fotos cerradas; cliente, tipo, pedido, producto y comentario visibles. |
| TA02 Detalles y comentario largo | Abrir muestra dirección/evidencia y comentario completo; cerrar recupera el tamaño; no perder información. |
| TA03 Móvil | Sin desbordamiento; acciones y Visto accesibles, agrupación intacta. |
| TA04 Sonido inicialmente bloqueado | Activar sonido y estado visibles fuera de Configuración; activación mediante gesto real. |
| TA05 Salir durante una ráfaga y volver | Parar audio al salir, conservar activación en el mismo documento/ámbito y liberar sólo la reserva propia. |
| TA06 Incidencia posterior al regreso | Sonar sin reactivar; no repetir identidades anteriores. |
| TA07 Otra cuenta/instalación o contexto suspendido | No heredar activación; estado desactivado explícito. |
| TA08 Recargar o cerrar sesión | No prometer autoplay; exigir activación cuando el navegador la requiera. |
| TA09 Dos pestañas y Visto compartido | Conservar ráfagas 5/10/15, una reproducción coordinada, detención al ver toda la ráfaga. |
| TA10 Datos y permisos | Sin cambios a API, tablas, Excel, cantidades, clasificación, cobros, APK o ruteo. |

Cambios: componente/estilos acotados de vivo, ciclo de vida del coordinador,
política técnica de conservación del audio, pruebas unitarias y de navegador.
No monitorizar fuera de las vistas de incidencias: al volver se recuperan
novedades con el cursor existente. Mantener aislamiento por instalación/actor.

Validación: regresión roja con el build anterior; Chrome real y PostgreSQL
aislado, medición de altura/expansión/audio, regresión de dos pestañas y Centro
de control, cobertura de la política técnica y mutaciones, tipos/lint/build y
auditoría productiva. No mocks ni accesos a servicios remotos. El navegador
comprueba Web Audio real; no acredita audibilidad de los altavoces del usuario.

Referencia oficial: https://developer.chrome.com/blog/autoplay; Next instalado
en node_modules/next/dist/docs/01-app/01-getting-started/11-css.md y
05-server-and-client-components.md. No se pueden saltar permisos de autoplay.
