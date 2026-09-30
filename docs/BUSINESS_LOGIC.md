# Ana Rutas — bloque 1 aprobado

## Planes semanales e incidencias por producto — BL-143..145

- BL-143 (sistema): archivar del selector planes de semanas terminadas el domingo
  a las 20:00 locales (confirmado por el usuario), incluyendo ese domingo,
  en la zona de la instalación. Conservar planes futuros, pedidos, publicaciones,
  ejecuciones, incidencias y métricas; nunca revocar una ruta ni liquidarla.
  Trabajo periódico transaccional, recuperable tras reinicio e idempotente;
  auditoría de sistema por plan. Archivo reduce carga del panel, no elimina disco histórico.
- BL-144 (chofer autorizado): tras llegada vigente registrar faltante por
  validación o bodega con producto/unidad manuales; desde una partida registrar
  reposición por calidad, producto erróneo o devolución total/parcial. Referencia
  inmutable ejecución/publicación/pedido/índice de partida. Cantidad positiva,
  decimal exacta y acumulado no superior a la partida. No convierte unidades,
  liquida, altera ventas ni escribe Odoo. Evento y recibo atómicos, versiones y
  reintentos persistidos; entrega posterior conserva incidencias abiertas.
- BL-145 (administrador): historial filtrado por fecha/chofer y Excel tabular:
  Fecha, Cliente, Producto, Cantidad, Unidad, Departamento,
  Detalle de la incidencia, Comentarios, Orden (nueve columnas exactas). Reposiciones pendientes en vivo con
  fecha/pedido/cliente/cantidad/producto/notas, independientes de cierre del plan.
  Resolución administrativa versionada y auditada, sin fingir entrega/Odoo.
  El chofer elige Departamento entre Operaciones y Compras. Validación con
  Operaciones propone Concepto Reparto; los demás conceptos quedan sin asignar.
  Bodega requiere motivo Especiales, Calidad o Llegada tardía. Admin puede editar
  Departamento/Concepto con versión y auditoría, conservando la clasificación original.
  Concepto es interno; nombre del chofer sólo se muestra en panel, nunca en Excel.
  Historial no ofrece Resolver: esa acción sólo aparece para reposiciones en
  Incidencias en vivo; la edición de clasificación permanece en historial.
  La captura permite verificar estructura, no igualdad binaria con un libro no adjunto.
- BL-146 (evidencia, confirmado): reposiciones de ambos tipos y devoluciones
  requieren una fotografía capturada por la APK; faltantes pueden enviarse sin foto.
  JPEG/PNG/WebP de hasta 8 MB se normaliza a WebP sin EXIF en volumen privado.
  Foto vinculada al hash del comando y a incidencia inmutable; miniatura y apertura
  completa sólo para administradores autenticados. No se exporta foto/URL en Excel.
  La evidencia de producto se conserva con el historial; no hereda el vencimiento
  de 24 horas de cliente cerrado. El archivo dominical nunca la borra. Sólo huérfanos
  sin referencia confirmada se limpian mediante el worker existente.
- Puertas: PostgreSQL real, permisos, versiones, replay, concurrencia, migración,
  límites de cantidad, filtros/paginación, XLSX y fórmula maliciosa, pruebas JVM,
  E2E y QA físico de APK; cobertura/mutación de políticas. Sin release hasta QA.

## Ventanas diarias de clientes — BL-142 (28/09/2026)

- Actor: administrador de Ana Rutas. Cada ventana de un cliente/sucursal se
  define únicamente con «Desde» y «Hasta» en formato de 24 horas y aplica todos
  los días, sin calendario semanal. Varias ventanas no pueden traslaparse.
- Dirección técnica: contrato, validación, directorio, Excel y lectura de
  pedidos/ruteo comparten los mismos intervalos en minutos, sin filtro por día.
  Odoo permanece en sólo lectura y no se cambian los horarios del pedido fuente.
- Datos: migración transaccional de ventanas anteriores; intervalos repetidos,
  contiguos o traslapados entre días se unen para no recortar disponibilidad.
  Los registros anteriores con días se conservan en una tabla de auditoría.
- Permiso: sólo el administrador autenticado modifica horarios. Se conservan
  control de versión, auditoría de cambios, límites y validación de entrada.
  Verificar migración concurrente, edición inválida, domingo, exportación,
  aislamiento por cliente y ausencia del selector de días en el panel.

## Tiempo al destino — BL-141

- Chofer/admin: tiempo estimado del Navigator activo, no ETA calculado por el
  panel ni tiempo total de ruta. Identidad ejecución/parada, edad propia y GPS
  vigente; invalidar al cambiar destino, parar, llegar o retirar ejecución.
- Todos los choferes: lista compacta desplegable con nombre/destino/tiempo por
  ejecución; nunca sumar/promediar ETA. Seleccionar fila cambia sólo ese filtro.
- Datos: telemetría opcional compatible con APK anteriores; permisos y secuencia
  existentes, sin cambios en entregas/liquidación. Sin auditoría por cada segundo;
  continúa auditoría de sesión. Validar parser, estados, PG, JVM, E2E y mutación.

## Vista individual compacta — BL-140 (26/09/2026)

- Administrador: Ruta en vivo debe dedicar el espacio restante de la ventana
  al mapa sin expandir. Un encabezado con ayuda/actualizar/expandir y filtro
  de chofer; retirar la leyenda global inferior. Dirección: composición React
  y flex CSS, sin cambiar feed, GPS, datos, permisos ni auditoría. Validar
  geometría, teclado, responsive, actualización y fullscreen con E2E real.

## Resumen junto a Google — BL-137 (26/09/2026)

- BL-137: Administrador -> resumen de entregas, pendientes y GPS al pie, junto
  al logo Google, sin ocultar atribuciones ni modificar cifras. Dirección
  técnica: control nativo BOTTOM_LEFT con contenido React; fallback local si
  Maps no carga. Datos/permisos/auditoría: sin cambios. Validación: regresión
  E2E, geometría responsive, montaje/limpieza del control revisados; posición
  final del proveedor por QA real de develop, no mocks.

## Mapa prioritario — BL-136 (26/09/2026)

- BL-136: Administrador -> cada pantalla de ruta prioriza el mapa completo,
  incluso en cuadrícula 2×2. Sólo filtra por chofer; una preferencia antigua de
  camioneta no debe ocultar rutas. Avance/lista se consultan en un panel
  desplegable sin recortar el mapa. Controles con fondo opaco, estado y nombre
  accesibles. La primera ubicación recibida entra al encuadre; las posteriores
  conservan cámara salvo seguimiento elegido. Nunca inventar GPS faltante.
  Datos: snapshot y preferencias existentes, sin nuevas escrituras de negocio.
  Permiso: admin autenticado. Auditoría: la del guardado de distribución.
  Validación: geometría/teclado/HTTP reales, política de encuadre con cobertura
  y mutación, investigación Android separada de QA físico no demostrado.

## Endurecimiento del canal en vivo — BL-135 (26/09/2026)

- BL-135: Administrador -> la conexión SSE informa cambios una vez y vuelve a
  latidos, ignora canales/payloads ajenos incluso si hereda una suscripción de
  una conexión PostgreSQL reutilizada, distingue sesión 401 de fallo transitorio,
  y libera la conexión ante un fallo real de `LISTEN` o cierre concurrente.
  Datos: eventos de panel existentes; no nuevas tablas. Permisos: sesión admin
  vigente. Auditoría: sin evento nuevo. Validación: PostgreSQL aislado real,
  pruebas de clasificación de errores, cobertura y mutación dirigida sin mocks.

## Barra única del Centro de control — BL-134 (26/09/2026)

- BL-134: Administrador -> el título compacto, la ayuda, el estado de guardado,
  «Agregar pantalla» y «Actualizar» comparten una sola barra para maximizar el
  alto de las pantallas operativas. El estado sigue reflejando el guardado real;
  agregar conserva el límite, foco y persistencia; actualizar vuelve a consultar
  rutas e incidencias. En un ancho estrecho la barra puede ajustarse sin tapar
  controles. Datos: distribución y consultas existentes, sin esquema nuevo.
  Permisos: sesión de panel existente. Auditoría: ninguna acción de negocio nueva.
  Validación: geometría y acciones E2E sobre servidor y PostgreSQL reales.

## Ajuste de densidad del Centro de control — BL-131 (26/09/2026)

- BL-131: Administrador -> la barra lateral presenta sólo navegación, y el
  Centro de control prioriza las pantallas operativas. La explicación de uso se
  consulta mediante un icono de información accesible junto al título, sin
  ocupar una fila permanente. Datos: ninguno. Permisos: sesión de panel
  existente. Auditoría: ninguna acción de negocio. Validación: E2E con teclado,
  visibilidad de ayuda y regresión de navegación y pantallas.

- BL-132: Administrador -> Incidencias en vivo muestra los casos de rutas
  iniciadas vigentes sin selector de fecha, conserva el filtro independiente
  por chofer y presenta resúmenes compactos en pantallas divididas. Detalles,
  evidencia y resolver siguen accesibles al expandir un caso. Datos: casos y
  publicaciones existentes, sin nueva tabla. Permisos: lectura y acciones de
  admin vigentes. Auditoría: la resolución existente; quitar una pantalla no
  altera casos. Validación: PG real entre días/revocación, API, E2E en pantalla
  dividida y vista independiente, además de regresión del histórico con fechas.

- BL-133: Administrador -> con cuatro pantallas en un monitor de escritorio, las
  cuatro tarjetas caben completas en una cuadrícula 2×2 sin desplazar la página.
  Los paneles extensos se desplazan dentro de su tarjeta y conservan filtros,
  acciones, estado y expansión. En ventanas estrechas o demasiado bajas se
  prioriza legibilidad y desplazamiento normal; no se comprimen controles hasta
  volverlos inutilizables. Datos, permisos y auditoría: sin cambios. Validación:
  geometría E2E a 1500×800, scroll interno, pantalla completa y regresión móvil.

## Centro de control y ruta en vivo — BL-126..130

- BL-126: Chofer con ruta iniciada -> transmite ubicación real y destino elegido,
  no el pedido consultado. Permiso: dispositivo y publicación vigentes. Datos:
  última muestra por ejecución, sesión y secuencia; sin historial de trayectos.
  Auditoría: inicio/cambio de sesión, no cada GPS. Validación: aislamiento,
  revocación, orden de muestras, coordenadas y recuperación sin cola histórica.
- BL-127: Administrador -> ve las ejecuciones vigentes, entregas/paradas reales
  y antigüedad/precisión del GPS. Nunca interpretar ETA como entrega ni ubicar un
  chofer sin muestra. Lectura autenticada; no modifica planes ni consume Routes.
- BL-128: Administrador -> agrega varias pantallas de Ruta en vivo, Avance de
  rutas, Incidencias en vivo o cualquiera de las demás secciones del panel,
  cada una con filtros independientes, expandir,
  quitar y cambiar orden. Distribución y filtros guardados por usuario con CAS;
  conflicto entre pestañas visible, nunca sobrescritura silenciosa.
- BL-129: Chofer -> servicio foreground visible mantiene ubicación durante ruta
  incluso con mapa minimizado; inicia desde actividad visible con permiso. No
  rastrear sin ruta, al cerrar sesión/revocar o tras detener seguimiento. Si SO
  mata proceso no fingir continuidad: panel indica última ubicación sin señal.
- BL-130: Administrador -> un mismo componente sirve Ruta en vivo y Centro de
  control. Una consulta compartida de rutas cada 5 s por vista visible; pantallas
  no multiplican lectura GPS. Incidencias mantienen sus acciones/autorización,
  fotos privadas y filtro por chofer en la vista en vivo; el histórico conserva
  sus fechas. No modifica llegada, cobros o cierre.

## Formulario de incidencias 0.6.2 — BL-124..125 (26/09/2026)

- BL-124: Chofer -> Cliente cerrado y Pedido rechazado se seleccionan mediante
  tarjetas exclusivas con iconos locales y señal de selección, en el diseño
  grafito/lima existente. No se añade Acceso bloqueado desde la referencia.
  Datos: selección local; permisos y auditoría: los del envío existente, cero
  escrituras al tocar una tarjeta. Validación: accesibilidad, exclusión mutua,
  deshabilitado durante envío y rechazo sin pedidos disponibles.
- BL-125: Chofer -> teclado y texto no recentran continuamente el formulario.
  Encabezado estable, cuerpo desplazable y un único propietario de insets del
  diálogo; el campo mantiene foco/borrador y admite comentarios multilínea.
  Datos: borrador local hasta confirmación; permisos, envío, cámara, recibo,
  reprogramación y teléfono operativo sin cambios de contrato. Auditoría: no
  evento por escribir/cerrar teclado. Validación: geometría/semántica Compose,
  notas conservadas en recomposición, JVM/lint/build y QA físico de IME.

## Regresiones operativas 0.6.1 — BL-120..123 (26/09/2026)

- BL-120: Chofer/admin -> un cerrado con foto sólo se confirma con recibo
  persistido y su ID; el panel recupera una señal perdida sin recarga, con
  filtros/métricas coherentes. Datos: caso/evidencia/recibo; mismos permisos
  privados. Auditoría histórica intacta. Pruebas: HTTP/PG/SSE y señal ausente.
  El incidente real reportado aún no tiene causa raíz demostrada; no se
  cambia la regla de ocultarlo durante una nueva llegada de reintento.
- BL-121: Chofer -> cerrado naranja incluso seleccionado. Una parada sin
  pedidos operativos (todos entregados/reprogramados) desaparece sólo del
  mapa, no de Ver paradas; grupos mixtos conservan los pedidos abiertos.
  Datos: proyección visual de su ejecución; sin escrituras ni nueva autoridad.
  Validación JVM: paleta, todos los estados y grupos mixtos.
- BL-122: Chofer -> Reintentar un reprogramado reabre sólo ese pedido en la
  misma ejecución vigente. Confirmación/cancelación explícitas, ninguna fecha
  ni entrega ficticia. Invalidar visita anterior y exigir nueva llegada GPS.
  Datos: pedido, visita, caso y eventos append-only; permiso: dispositivo
  dueño, publicación vigente; versiones/locks/recibos contra carreras y replay.
  La reprogramación original y su resolución administrativa siguen auditables.
- BL-123: Chofer -> GPS caducado solicita automáticamente una muestra actual;
  cancelación al salir, reintentos acotados y recuperación al activar proveedor.
  Sin GPS real/preciso/reciente, permiso o radio válido no se habilita Llegué.
  Datos: ubicación efímera, sin nuevas llamadas Routes/Fleet ni telemetría
  privada en logs. Validación: política JVM, ciclo de vida y QA físico sin ADB.

## Atención e incidencias operativas — BL-111..116 (25/09/2026)

- BL-111 · Llegada y cambio de destino. Actor: chofer de la ejecución vigente.
  «Llegué» conserva un evento histórico; sólo habilita atención de esa visita.
  Si sale hacia otra parada sin registrar atención ni incidencia, la anterior
  vuelve a **abierta**, sin crear incidencia ni entrega. Regresar exige una nueva
  llegada validada por GPS. Datos: estado operativo de la visita, no pedidos ni
  orden de ruta. Permiso: sesión móvil y ejecución propia. Auditoría: eventos de
  llegada y salida inmutables. Validación: cambio de destino repetido o fallido
  no duplica eventos ni inventa una entrega.
- BL-112 · Incidencia «Cliente cerrado». Actor: chofer que llegó al domicilio.
  Requiere fotografía real antes de enviar. Si la parada contiene dos pedidos,
  **ambos** quedan pendientes de reintento; el mapa los distingue con
  admiración y al tocar el punto ofrece «Reintentar pedido». Datos: incidencia,
  estado de cada pedido y evidencia privada.
  Permiso: ejecución propia y pedido asignado. Auditoría: creación/reintentos/
  resolución. Validación: no se registra sin foto, sin llegada vigente, dos
  envíos no crean dos incidencias. Administración **no** puede marcar este
  tipo resuelto: el chofer debe reintentar. Al confirmar una nueva llegada
  válida, sale de «Incidencias en vivo»; si abandona sin atender, vuelve a
  pendiente. Si sigue cerrado, puede reprogramar; entregar cierra el caso.
- BL-113 · Incidencia «Pedido rechazado». Actor: chofer que llegó al domicilio.
  Motivos: mala calidad, llegada tarde u otro con texto obligatorio. Queda
  **rechazado**, no pendiente de reintento, pero el chofer puede volver y
  entregarlo si el cliente cambia de opinión. Datos/permiso/auditoría como
  BL-112, sin exigir foto. Validación: rechazo no se contabiliza como entrega
  ni bloquea una entrega posterior; el cierre de ruta no debe falsificarla.
- BL-114 · Panel «Incidencias en vivo». Actor: administrador autenticado.
  Es una entrada propia del panel lateral y una pantalla independiente, con
  filtro de chofer propio, sin selector de fecha. «Incidencias» conserva exclusivamente
  repuntes, llegadas fuera de horario y reglas de llegada; no contiene este panel.
  Muestra evidencia autorizada, negocio/causa, chofer, fecha, estado y métricas
  separadas por chofer; refresca mediante los eventos del panel existentes.
  «Resolver» sólo se ofrece donde corresponda (reprogramación y rechazo),
  registra actor/hora y retira la evidencia visual. Un «Cliente cerrado» sólo
  sale de la vista activa por reintento real del chofer, reprogramación o
  entrega. Al cerrar una ruta ya liquidada sus incidencias dejan la vista del
  módulo, pero el rastro auditable permanece. Datos: proyección operativa e
  historial, no Odoo. Validación: filtros y métricas coherentes ante
  concurrencia, reintentos y desconexión; ninguna incidencia se mezcla entre
  choferes.
- BL-115 · Evidencia. Actor: chofer al fotografiar y servidor al custodiar.
  Almacenamiento privado separado de las fotos de unidad; caducidad automática
  a las 24 h desde su aceptación por el servidor o retiro anticipado al
  resolver, sin borrar el evento histórico. Permiso: sólo chofer dueño y administradores autenticados
  mientras esté vigente. Auditoría: captura/acceso/resolución/caducidad.
  Validación: tamaño, tipo real, aislamiento, huérfanos y fallo de almacenamiento.
- BL-116 · Teléfono operativo. Actor: chofer de ruta vigente. «Llamar al
  cliente» usa `route_customers.phone`; si falta, muestra ausencia y permite
  añadirlo o cancelar. Guardar actualiza la ficha de cliente y lectura móvil
  vigentes, con control de versión y auditoría, sin escribir a Odoo; la siguiente
  sincronización de Odoo no revierte el cambio. Validación: formato telefónico,
  autorización, concurrencia y marcación segura sin exponer otro cliente.
- BL-117 · Reprogramación. Actor: chofer que atiende un pedido pendiente.
  «Reprogramar» abre confirmación Aceptar/Cancelar con nota opcional; **no**
  pide ni calcula fecha. Al aceptar **cierra ese pedido en la ruta actual** y
  crea una incidencia en vivo con la nota. Administración decide después si
  lo incluye en otra ruta y en qué fecha; «Resolver» marca esta incidencia
  resuelta, sin reabrir ni entregar el pedido original. Datos: pedido, nota,
  chofer y ruta origen; permiso: ejecución propia. Auditoría: aceptación y
  resolución; validación: no duplicación, conflicto con entrega/rechazo y
  actualización del panel. Este botón no mueve ni crea rutas futuras. BL-122
  permite al chofer reabrir explícitamente ese pedido en esta misma ruta;
  Resolver nunca lo reabre por sí solo.
- BL-118 · Liquidación y cierre (bloque posterior). Actor: chofer entrega su
  liquidación y un administrador **autorizado para liquidar** registra efectivo
  recibido y comprueba el cuadre. La ruta sólo podrá cerrarse tras ambos hechos
  confirmados; terminar navegación o marcar entregas no equivale a cierre.
  Datos: importes por cobrar/cobrados, diferencias, recibos, actor y tiempos;
  permiso: rol específico de liquidación, separado del mero acceso al panel.
  Auditoría: eventos inmutables de entrega, recepción, conciliación y cierre.
  Validación: importes exactos, diferencias, concurrencia, doble cierre y
  trazabilidad por pedido. No se implementarán cálculos con importes ausentes
  ni escrituras Odoo sin un contrato de origen y autorización explícitos.
- BL-119 · Lectura del mapa. Actor: chofer en ruta. Todas las paradas no
  seleccionadas conservan un contorno visible sobre el mapa oscuro; sólo el
  destino seleccionado mantiene el relleno destacado actual, salvo cliente
  cerrado que conserva naranja según BL-121. Datos: estado
  visual derivado de la ejecución propia, sin escritura. Permiso: mapa de su
  ejecución vigente. Auditoría: no aplica por ser presentación. Validación:
  estados normal/llegada/selección distinguibles sin cambiar la guía.

La futura asignación de pedidos reprogramados es una decisión administrativa
fuera de este bloque; no existe calendario automático. El cierre financiero
pertenece al bloque posterior y no se presume que ya exista.

## Ajuste de navegación y repunte — BL-109..110 (25/09/2026)

- BL-109: el chofer puede consultar pedidos de cualquier parada sin alterar su ruta;
  sólo al pulsar «Ir a esta parada» se selecciona ese destino y se reemplaza la
  guía activa. Actor: chofer de la ejecución vigente. Datos: parada y coordenadas
  de la ejecución propia, sólo lectura; ninguna entrega, orden o asignación cambia.
  Permiso: sesión móvil y ejecución verificada no retirada. Auditoría: no se crea
  evento de negocio por cambiar una guía local. Validación: respuesta tardía del
  SDK no puede reactivar el destino anterior; fallo del SDK deja reintento visible.
- BL-110: «Mal punteado» permite usar una ubicación GPS actual o escoger el pin
  manualmente en el mapa aunque el punto anterior esté lejos. Actor: chofer de la
  ejecución vigente. Datos: punto y domicilio corregidos en la transacción de
  repunte existente. Permiso: los del comando actual; sin acceso a otro chofer.
  Auditoría: historial e incidencia de repunte existentes. Validación: GPS real,
  reciente y preciso debe estar dentro del radio del punto **nuevo** para confirmar;
  «Llegué» mantiene exactamente la misma política. Nada se escribe al mover el pin.

Corrección 0.5.3 a BL-106/107: el chofer evalúa llegada y repunte contra el reloj
monotónico actual, no contra el último pulso de pantalla. No cambia radio, precisión,
vigencia, autorización ni auditoría de los comandos. Validación: F01..02.
Mapa administrativo: «Todas las camionetas» representa sólo pedidos asignados a
camionetas del plan; quitar una asignación no borra el pedido, que puede consultarse
en «Sin asignar». Sólo se muestran trazos/métricas compatibles con la versión y
secuencia actuales. Lectura autenticada existente, sin escritura ni auditoría nueva;
validación F03..06 en MASTER-SPECIFICATION.

## Propuesta siguiente — BL-105..108 (24/09/2026, aún no implementada)

Diseño y criterios completos en `BLOQUE-MAPA-LLEGADA-REPUNTE.md`:

- BL-105: ejecución propia y mapa al iniciar, todas las paradas, sin reordenar ni
  confundir navegación con entrega.
- BL-106: «Llegué» valida ubicación reciente/radio en servidor, es idempotente y
  abre atención del pedido; radio inicial de 100 m pendiente de confirmación.
- BL-107: repunte actualiza inmediatamente la parada propia y el cliente para
  futuras rutas, decisión confirmada por el usuario; historial e incidencia
  atómicos, sin Odoo ni cambios en publicaciones ajenas.
- BL-108: incidencias reales filtradas por fecha y chofer, decisión confirmada
  por el usuario; actualización en vivo conserva filtros e histórico.

Actor, datos, permisos, auditoría, validación y parámetros propuestos se detallan
en ese documento. Devoluciones/cobros/evidencias/entrega completada no incluidos.
Las reglas históricas «captura móvil pendiente» serán sustituidas únicamente al
implementar y validar este bloque. Construcción aprobada con «dale» el 24/09;
el radio inicial configurable es 100 m. No certifica integración física.

## BL-103: avisos nativos de ruta para la APK cerrada

- Sólo dos eventos: publicación/asignación de una ruta para el chofer y retiro/cancelación de su ruta. Republicar sin cambios no genera otro aviso; reasignar notifica retiro al anterior y publicación al nuevo.
- La publicación, retiro y su intención de notificar se confirman en una sola transacción PostgreSQL. Un rollback no envía nada. FCM es transporte asíncrono: su falla nunca revierte la operación de rutas.
- El aviso no lleva nombre de cliente, pedidos, dirección, teléfono ni enlace con credenciales. Al abrirlo, la APK consulta `/api/mobile/dashboard` con su sesión; éste sigue siendo la autoridad. La APK visible mantiene SSE y consulta de respaldo.
- Cada instalación Firebase (FID) se vincula a un dispositivo móvil autenticado, no a un chofer indicado por el cliente. Cerrar sesión desactiva los avisos de ese dispositivo; revocar acceso o dispositivo impide nuevos envíos. La app vuelve a registrar la instalación al entrar.
- La entrega usa cola durable con intentos acotados, deduplicación por cambio y dispositivo, caducidad, validación de asignación vigente antes de enviar y aislamiento por instalación. FCM puede duplicar o demorar entregas; la pantalla nunca acepta el contenido push como estado de ruta.
- Se requiere proyecto Firebase Android real, permiso de notificaciones de Android y credencial de servicio sólo en el servidor de cada instalación. Ninguna credencial privada se incluye en APK o Git.

## BL-102: entrega visible de rutas publicadas

- Actor: administrador publica y chofer autenticado recibe su ruta.
- Regla: la publicación confirmada aparece automáticamente en la APK abierta, sin pulsar Actualizar; una asignación nueva o revisada muestra un aviso en la app. Una ruta retirada desaparece igualmente.
- Dirección técnica: señal PostgreSQL después del commit, canal móvil autenticado y acotado por chofer, lectura del dashboard como autoridad y consulta periódica de respaldo. Cero llamadas Google/Odoo al recibir señales.
- Datos: publicaciones y asignación vigentes; el evento no lleva pedidos, teléfonos ni tokens.
- Permiso: sesión móvil vigente, chofer activo y asignación real; cierre ante revocación.
- Auditoría: la publicación conserva el evento `route.publication.changed`; la señal no crea mutaciones.
- Validación: integración PostgreSQL, contrato SSE, pruebas Android, desconexión/reconexión y aislamiento entre choferes.
- Límite: una notificación del sistema con la APK cerrada requiere Firebase Cloud Messaging y credenciales de entorno; no se simula con un servicio permanente.

## BL-101: espacio del chofer y navegación compacta

Actor: chofer autenticado. Inicio muestra saludo real y tarjetas Ruta activa,
Pedidos, Mi unidad e Historial conectadas al estado autorizado. Drawer y barra
inferior comparten destinos; Atrás cierra overlays y vuelve a Inicio. Las rutas
históricas se etiquetan y no habilitan Inicio ni captura del día actual. Las
preferencias locales permiten mantener encendida la pantalla durante una ruta
iniciada y abrir permisos de Android; no cambian datos ni permisos de servidor.
Pedidos se filtran localmente y abren detalle real. Inicio conserva confirmación,
revisión, fecha y cinco fotos. El mapa apunta a la ruta iniciada de hoy incluso
cuando se consulta historial. Lecturas/sesión y auditoría de mutaciones existentes
se conservan; diseño sin contadores, mapas ni progreso ficticios.
Validación: navegación, filtros, ruta del día frente a historial, permiso de Inicio,
pruebas Android/contratos existentes y revisión visual del artefacto disponible.

## BL-100: panel operativo en vivo

Administrador: los cambios confirmados de rutas, publicaciones/inicios, fotos,
flota, clientes, accesos y auditoría invalidan las consultas del panel mediante
SSE autenticado. No se ejecutan Google/Odoo ni optimizaciones al recibir eventos.
PostgreSQL notifica después del commit, nunca tras rollback; sólo transmite una
señal sin datos privados. La reconexión vuelve a consultar la sección visible.
Formularios locales se conservan y las escrituras mantienen expectedVersion.
El panel visible conectado cuenta como actividad; ocultarlo corta el canal y
permite la expiración por inactividad existente. Vencimiento absoluto, cierre y
revocación siguen obligatorios. Incidencias reales requieren su futuro evento de
llegada: este bloque no inventa registros ni sustituye ese módulo pendiente.
Validación: PostgreSQL real, HTTP/SSE, dos navegadores, permisos, rollback,
reconexión, sesión tras recarga, cero consultas a proveedores y pruebas de mutación.

Política vigente de armado: **BL-FD01..08, `BLOQUE-FLEET-DIRECTO.md`**. Una
solicitud global y conservación directa del resultado vial completo. Preferencias
dentro del modelo; sin comparar/reordenar/vetar por prioridad después. El flujo
multicandidato descrito abajo queda histórico, salvo recuperación por fallo.

Política vigente: FC08..FC14 en `BLOQUE-CONTROL-COSTO-FLEET-ROUTING.md`,
BL-078..082 en `BLOQUE-BUSQUEDA-GLOBAL-VIAL.md`,
BL-072..076 en `BLOQUE-RUTEO-GEOGRAFICO-FINOPS.md`,
BL-069..071 en `BLOQUE-SECUENCIA-VIAL-PRIORIDAD.md`, y BL-065..068 de
`BLOQUE-RUTEO-DETERMINISTA.md`. **Armar ruta**
no llama LLM; Google y Ana Rutas resuelven mediante optimización y validación
deterministas. Alta → Media →
Por horario por camioneta, destinos indivisibles y horarios flexibles medidos.
La precedencia se incorpora en una segunda optimización vial con la asignación
fijada; queda prohibido reordenar manualmente una ruta que Google ya calculó.
Sustituye reglas anteriores que aceptaban inversiones de prioridad o corregían
el color después de optimizar las calles.
Compara separadamente reparto entre camionetas y orden de visitas; el horario
nunca veta una salida ni convierte una entrega tardía en pedido omitido. Después
de prioridad, ventanas y uso de flota mandan la jornada y las calles reales; el
conteo de pedidos/destinos es guía blanda y desempate, nunca una ruta artificial.
BL-064 agrega balance verificable de pedidos y destinos por unidad: el servidor
mide una línea base dinámica con grupos indivisibles y ninguna capacidad inventada.
BL-072 reemplaza esa base ciega a coordenadas por sectores geográficos
contiguos alrededor de la bodega; BL-074 mide además una secuencia de fecha
límite cuando la propuesta vial conserva retrasos. Ninguna ventana bloquea el lote.
BL-077 convierte la coordenada confirmada en unidad indivisible del reparto:
clientes distintos conservan identidad y pedidos, pero no pueden viajar en
camionetas diferentes si representan la misma parada física. Después de
prioridad, retrasos y uso de flota, el objetivo operativo combina conducción
total y jornada máxima; viaje y distancia anteceden al equilibrio y la espera.
La compactación entre prioridades sólo se mide cuando conserva cero inversiones.
BL-078..082 sustituyen la comparación cerrada de hasta seis candidatos por tres
semillas independientes y búsqueda `relocate/swap/2-opt` hasta convergencia. La
cantidad de alternativas nace de los datos y de mejoras estrictas, no de un
máximo fijo; las alternativas se recalculan con Google Routes para ETA, regreso,
distancia y mapa antes del guardado. Se descarta una matriz N×N porque su consumo
crece cuadráticamente sin mejorar la autoridad vial final de Google.
FC08..FC14 eliminan la amplificación restante: balance y clúster compiten
primero mediante prioridad, ventanas, búsqueda local y Google Routes. El ganador
completo entra como `injectedFirstSolutionRoutes` en la única solicitud Fleet
Routing, que permanece libre para mejorar reparto y secuencia. La respuesta se
revalida, se ordena por prioridad y se mide antes de competir. Si Google falla,
omite o rechaza, la base local completa se guarda sin reintento; mover pedidos
manualmente usa cero Fleet Routing.

BL-065..068 sustituyen a BL-029/035/036/060 donde asignaban autoridad a OpenAI.
Toda explicación generativa queda fuera del ruteo: prioridad, ventanas, uso de flota,
balance y recorrido se comparan mediante métricas reproducibles del servidor.

Consulta Incidencias: BL-063 / IN01..08 en `BLOQUE-INCIDENCIAS-LLEGADA.md`.
Previsiones vigentes por destino, lecturas autenticadas con snapshot consistente.
Llegadas reales pendientes de la APK: «Llegué» iniciará surtido, no completará entrega.

Extensión vigente de carga ordinaria: BL-041..047 en `BLOQUE-SELECCION-ODOO.md`.
Consulta sin cambios del plan, selección explícita y confirmación atómica de
salidas validadas/pendientes; flota sólo al confirmar. Manual BL-015 independiente.

Resiliencia de volumen vigente: BL-051..054 en `BLOQUE-RUTEO-VOLUMEN.md`.
El lote cargado se valida y persiste con cobertura exacta, sin límite de negocio,
sin abortos locales arbitrarios y sin resultados parciales. Los horarios
generan avisos; BL-069 exige optimizar las prioridades dentro del proveedor
vial antes de medir y guardar, nunca ordenarlas después.

Observabilidad de ruteo vigente: BL-055..057 en
`BLOQUE-OBSERVABILIDAD-RUTEO.md`. EasyPanel recibe progreso natural y
correlacionado sin datos personales ni secretos; registrar nunca altera la
transacción.

Cada instalación es independiente. Los nombres de tablas siguientes pertenecen exclusivamente al proyecto nuevo; no describen tablas de five.

| Regla               | Actor / negocio                                                    | Dirección técnica / datos                                                             | Permiso y auditoría                                                | Validación                                                                                |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| BL-001 Portabilidad | Operador instala mismo código en develop/main                      | Entorno runtime; identidad de instalación en DB; ningún fallback a conexiones de five | Credenciales sólo servidor; no herramientas de infraestructura     | Configuración incompleta falla cerrada; DB ajena rechazada                                |
| BL-002 Identidad    | Cada persona tiene cuenta propia, mismo rol administrador de rutas | Cuentas locales, contraseñas scrypt, sesiones opacas persistidas con hash             | Alta inicial con secreto de bootstrap; siguientes altas con sesión | Alta inicial única concurrente; duplicados rechazados; no registro público                |
| BL-003 Acceso       | Varias computadoras pueden operar                                  | Sesiones independientes, expiración absoluta e inactividad, cierre/revocación         | API y páginas verifican sesión; usuario desactivado pierde acceso  | CSRF, credenciales incorrectas, sesiones expiradas y revocadas                            |
| BL-004 Plan inicial | Administrador selecciona día y guarda borrador                     | Fecha operativa explícita; versión para edición concurrente; persistencia propia      | Autor de creación/cambios registrado                               | Un borrador por fecha; cambio obsoleto devuelve conflicto, nunca pisa otro                |
| BL-005 Odoo         | Backend ejecuta una operación de rutas que requiere datos Odoo     | Conector cerrado: autenticación, empresa y consultas específicas; sólo lectura        | Configuración runtime ODOO_URL/DATABASE/EMAIL/API_KEY/COMPANY_ID   | Sin pantalla de conexión ni métodos write/create/unlink; HTTPS; sin secretos en respuesta |
| BL-006 Alcance      | Usuarios no deben confundir una base inicial con un ruteo completo | Panel vacío real; no pedidos, choferes ni rutas inventadas                            | Funciones posteriores identificadas como pendientes                | Ningún botón simula operación no implementada                                             |

## Próximos bloques (no implementados todavía)

Bloque 2A autorizado: BL-007..010 (camionetas, choferes, asignación actual y documentos privados), especificado en BLOQUE-2-FLOTA.md.

2. Unidades, choferes y documentos privados; clientes, direcciones, coordenadas, ventanas y prioridades.
3. Importación idempotente de surtidos validados, selección de unidades, carga manual, retiro recuperable, reutilización entre planes y borrado de borradores: BL-011..017 en BLOQUE-3-PEDIDOS.md. Calendario operativo completo posterior.
4. Directorio completo Odoo, preferencias locales, ventanas, prioridades, ubicación, archivo reversible y exportaciones: BL-018..024 en BLOQUE-4-CLIENTES.md.
5. Optimización, arrastre y recálculo de rutas afectadas, conflictos de ventanas, publicación versionada.
6. Asistente flotante con herramientas nativas; mismos servicios de dominio que botones, trabajos durables y recuperación.
7. APK Android, GPS, incidencias, llegadas y corrección de punto; liquidaciones y reportes según procesos autorizados.

## Extensión aprobada — BL-017 eliminación de plan

- Actor: administrador autenticado y activo.
- Regla: puede borrar un borrador completo sólo después de confirmarlo y usando su
  versión vigente.
- Dirección y datos: una transacción elimina `route_shipments`,
  `route_plan_vehicles` y `route_plans` únicamente para ese ID.
- Permiso y auditoría: actor tomado de sesión; evento `plan.deleted` conserva nombre,
  fecha y cantidades, sin secretos ni contenido Odoo.
- Validación: Cancelar/Escape no escriben; versión obsoleta no elimina; flota,
  choferes, usuarios, auditoría y Odoo permanecen intactos.

## Decisiones pendientes que no se inventan

- Captura acordada: una sola fecha de validación de pedidos, inicializada con el día civil actual de la instalación y editable hasta la fecha del plan. La carga manual por folio puede recuperar surtidos validados fuera de esa fecha; corte, días laborables/feriados todavía pendientes.
- La carga manual puede iniciar un plan nuevo: conserva camionetas preexistentes y guarda las camionetas marcadas junto con el lote, atómicamente y sin consulta previa por fecha. La primera publicación calcula el recorrido sin Fleet Routing ni reordenar; movimientos posteriores recalculan sólo las camionetas afectadas y reutilizan el resto. Fallo de cálculo deja el plan sin publicar.
- El administrador configura la hora de salida por plan en formato de 24 horas. Todas
  las camionetas regresan al mismo punto y el cálculo incluye ese tramo.
- Procedimiento real de devoluciones/contabilidad: no hay autorización de escrituras Odoo para ese alcance.

## Extensión aprobada — optimización Google

| Regla             | Actor / negocio                                                                                          | Dirección técnica / datos                                                               | Permiso y auditoría                                         | Validación                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| BL-026 Salida     | Administrador configura el origen de todas las rutas                                                     | Dirección editable y coordenada confirmada; salida y regreso a la misma bodega          | Sesión activa, versión y `routing.settings.updated`         | Dirección sin punto bloquea optimización; rango geográfico estricto               |
| BL-027 Modelo     | Administrador arma el plan con datos reales, sin peso                                                    | Camionetas del plan, coordenadas confirmadas, ventanas, prioridad y día civil local     | Modelo construido sólo en servidor; Google OAuth privado    | Sin flota/pedidos/puntos no llama Google; ninguna capacidad inventada             |
| BL-028 Prioridad  | Alta, Media y Por horario ordenan cada camioneta según BL-058, sin omitir entregas                       | Precedencia por destino normalizada antes de medir; horarios flexibles medidos          | Política única auditable, no elegida por el navegador       | Cero inversiones en generación automática; atrasos se informan y el lote continúa |
| BL-029 Aplicación | Google propone y Ana Rutas compara contra una base balanceada; gana el menor score determinista completo | Snapshot por versión y aplicación transaccional; métricas/ETA/polilínea persistidas     | `plan.optimized`; actor, planificador y candidatos medidos  | Cambio concurrente devuelve 409; reintento no duplica                             |
| BL-030 Navegación | Web muestra recorridos reales y APK futura podrá navegar cada tramo                                      | Polilíneas visibles; route tokens privados; recálculo manual incluye regreso            | Sólo endpoints autenticados; tokens no salen en tablero web | Movimiento manual conserva acomodo y recalcula sin redistribuir                   |
| BL-031 Precisión  | El origen debe representar un domicilio real, no la primera coincidencia                                 | Geocodificación restringida al país; acepta domicilio preciso o ajuste manual explícito | Misma sesión y guardado versionado de BL-026                | Parcial/aproximada sólo centra el mapa; edición limpia la propuesta               |

## Extensión aprobada — control de consumo oficial de Google

| Regla                 | Actor / negocio                                                   | Dirección técnica / datos                                                                      | Permiso y auditoría                                         | Validación                                                           |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| BL-037 Fuente oficial | Administrador consulta uso y costo confirmados                    | Cloud Billing Standard y Pricing exports filtrados por proyecto/SKU Maps                       | Cuenta FinOps privada, sesión y auditoría de sincronización | Sin datos/configuración muestra estado explícito; nunca inventa cero |
| BL-038 Acumulación    | Administrador conoce consumo, restante y momento de cobro por SKU | Google se vuelve a agregar por ciclo y reemplaza una caché local; límites derivados de pricing | PostgreSQL no incrementa consumo                            | Reintentos y correcciones no duplican; cuotas independientes         |
| BL-039 Actualización  | Datos avanzan cuando Google publica nueva exportación             | Sincronización durable periódica y manual con lease, frescura y último `export_time`           | Un trabajo concurrente; error sanitario                     | Fallo conserva último dato marcado como desactualizado               |
| BL-040 Presentación   | Control sólo en navegación lateral, nunca dentro del mapa         | Costo, créditos, historial y medidor por SKU en moneda Google                                  | Todos los administradores autenticados                      | Texto además de color; responsive; secretos ausentes                 |

## Bloque móvil 1 aprobado — acceso y ruta del chofer

BL-083..087 y los escenarios M01..M14 están definidos con actor, datos, permiso,
auditoría y validación en `BLOQUE-APK-CHOFER-ACCESO.md`. Teléfono + PIN de cuatro
dígitos vincula automáticamente el primer dispositivo mediante una clave
no exportable de Android Keystore; los accesos posteriores exigen la prueba
criptográfica del dispositivo. La identidad móvil no reutiliza las cuentas administrativas.
La APK lee únicamente la ruta del chofer autenticado. Llegadas, incidencias,
transferencias y cobros requieren sus propios bloques y no se simulan aquí.

## Bloque móvil 2B aprobado — ruta publicada, fotos e inicio

BL-088..095 y MR01..17 están desarrollados en `BLOQUE-APK-RUTA-PUBLICACION.md`.
El borrador del panel no es visible al chofer hasta publicación por camioneta;
una republicación reemplaza su snapshot sin duplicarlo. Cinco fotos WebP válidas
de la unidad y fecha habilitan el inicio, con máximo ocho y retención de quince
días en almacenamiento privado persistente. El inicio bloquea sólo la camioneta
dentro de ese plan: sus pedidos, orden y responsable publicado quedan fijos;
la asignación persistente de flota puede cambiar para rutas futuras. Las otras
camionetas del plan continúan editables. El mapa usa datos reales de ruta y,
para giros en vivo, Navigation SDK con costo observado por destino.

## Ajuste 2B — captura actual y confirmación de salida

- BL-096: el chofer sólo puede abrir la cámara para documentar su unidad; la APK no ofrece galería ni carga desde archivos. La foto se toma antes de salir y se sube desde caché privada, que se limpia tras el intento. El servidor no cuenta dos veces una imagen idéntica y rechaza reutilizarla en otra ruta/fecha de la misma camioneta. Sólo el chofer publicado vigente puede cargarla; se audita la aceptación. Esto no constituye una prueba criptográfica contra un celular o cliente modificado ni contra fotografiar una pantalla.
- BL-097: tocar «Iniciar ruta» muestra primero camioneta, ruta y número de paradas; cancelar no escribe nada. Confirmar envía la revisión publicada que el chofer vio. Si administración republicó mientras el diálogo estaba abierto, el servidor rechaza el inicio y exige actualizar; el servidor conserva la validación de identidad, fecha y cinco fotos.
- BL-098: la APK sólo ofrece la función de fotos cuando el endpoint desplegado responde correctamente. Un 404 HTML de versión antigua se comunica como servidor pendiente de actualización, sin confundirse con una ruta revocada. La retención de quince días se informa en administración, no en la pantalla del chofer. Antes de la prueba live se requiere backend actualizado y volumen persistente privado.

## Ajuste 2B — descartar una foto antes de salir

- BL-099: el chofer autenticado puede revisar y eliminar sólo una foto propia de la unidad, plan y fecha de servicio que tiene publicados, antes de iniciar la ruta. La APK pide confirmación sobre la foto elegida y actualiza el conteo desde el servidor; con menos de cinco fotos, Inicio vuelve a quedar inhabilitado. Después del inicio no aparece la acción y la API rechaza el borrado aunque un cliente modificado lo intente. La operación se serializa con el inicio, audita chofer/foto/plan/unidad y retira el metadato y el WebP privado sin exponer rutas de archivo. Si falla el borrado físico tras retirar el acceso, la limpieza de huérfanos lo reintenta. No afecta fotos de otras unidades, rutas o choferes.
# BL-104: cancelar publicación y mostrar sólo cambios propios

Administrador activo puede cancelar una ruta publicada antes o después del inicio, con confirmación, versión del plan y revisión publicada. Se revoca únicamente la publicación: los pedidos quedan asignados a la misma camioneta y conservan su orden en el borrador para agregar o modificar paradas; se conservan fotos y auditoría. El dashboard móvil la retira y el outbox FCM encola el aviso existente. Guardar y publicar se muestra sólo si cambian pedidos/orden, chofer, datos visibles o recorrido de esa camioneta; la versión global por cambios ajenos no constituye un cambio propio. Validación: PostgreSQL, API/UI, aislamiento, concurrencia con inicio, eventos y mutación.
## BL-147 — formulario de incidencias y evidencia múltiple

Chofer con llegada vigente: hasta tres fotos por incidencia de producto; una
incidencia no cierra el pedido. Sin tope de cantidad de incidencias por pedido;
se mantienen controles de cantidad real por partida, no un límite de reportes. Una
foto basta en reposiciones/devoluciones, faltantes siguen con evidencia opcional.
Puede quitar capturas individuales antes del envío, nunca evidencia ya registrada.
Departamento: Operaciones/Compras/Ventas. Concepto: Especiales/Reparto/Picking.
Comentarios rápidos multiselección y notas adicionales, conservando ambos sin
duplicarlos. Los faltantes usan las mismas tarjetas seleccionables de incidentes.
Admin ve todas las fotos privadas y conserva edición auditada de clasificación.
Excel conserva nueve columnas; Comentarios reúne selecciones y notas, no fotos,
chofer ni Concepto. Sin cambios Odoo. Validar límites, privacidad, transacción,
recibos, compatibilidad APK anterior, rotación y recuperación.
## BL-148 — corrección y cancelación de incidencias por producto

Una incidencia enviada permanece visible al chofer como «Incidencia enviada». Si modifica sus datos, el formulario vuelve a «Guardar incidencia»; el servidor exige versión vigente y conserva cada cambio en un registro append-only. Si el cliente desiste, el chofer confirma «Eliminar incidencia»: se cancela operativamente sin borrar evidencia ni auditoría. Una incidencia cancelada no consume cantidad, no exige reconocimiento al confirmar la entrega, no entra a Incidencias en vivo ni al Excel. Sólo se puede corregir o cancelar durante la visita activa y antes de cerrar el pedido; una resolución administrativa impide corrección posterior.

El desglose muestra cantidad neta = cantidad publicada − suma de incidencias activas vinculadas a esa partida, y marca con alerta ámbar cualquier partida afectada. Los faltantes escritos manualmente, que no existen en las partidas publicadas, aparecen como renglones separados con alerta, sin descontar otra partida. La cantidad publicada e historial de eventos permanecen intactos. Varias incidencias en un pedido se agregan; la suma de las de una partida no supera la cantidad publicada, también en ediciones concurrentes. Evidencia existente se conserva al editar/cancelar.

## BL-149 — faltantes claros y retiro de canceladas del panel

Chofer: las cantidades se presentan sin ceros decimales sobrantes, preservando las fracciones exactas y sin modificar lo escrito durante la captura. Faltante por validación y desde bodega capturan producto, cantidad faltante y unidad una sola vez, juntos; no muestran cámara/evidencia ni el campo adicional «Cantidad afectada». Su único comentario rápido nuevo es «No venía el producto en el pedido», además de notas libres. Comentarios/evidencia históricos siguen conservados. Reposiciones y devoluciones mantienen evidencia obligatoria y el catálogo completo. Administrador: Resolver tiene palomita verde; canceladas se excluyen de Incidencias, contadores, paginación, vista en vivo y Excel desde la consulta autenticada. Auditoría y evidencia privada persisten sin borrado físico. Validar cantidades exactas, compatibilidad de recibos antiguos, filtros/paginación y cancelación real por API.

## BL-150 — eliminación administrativa de incidencias por producto

Administrador activo puede eliminar desde Incidencias una incidencia pendiente o resuelta mediante bote rojo y confirmación del producto/pedido. En pedido abierto se cancela operativamente, deja de descontar cantidad y actualiza revisiones de ejecución/parada/pedido. En pedido cerrado (delivered/rescheduled) sólo se excluye del reporte/panel/Excel: conserva estado de incidencia, cantidades, resolución, entrega y revisiones de ruta/parada/pedido. En ambos casos conserva evidencia y auditoría con administrador, estado anterior y fecha; no reabre ni entrega el pedido. Requiere sesión administrativa, mismo origen y versión vigente; petición repetida del mismo administrador no duplica auditoría. Se serializa con operaciones del chofer, incluida la confirmación de entrega, y verifica el estado cerrado dentro del bloqueo. La exclusión de reporte es independiente de la cancelación operativa. Validar ambos estados de cierre, pendiente/resuelta, migración, permisos, concurrencia y reintentos.

### BL-150A — rutas canceladas y planes retirados

La eliminación administrativa del reporte no depende de que la ruta siga publicada: si su ejecución ya no corresponde a una publicación iniciada vigente (cancelada, sustituida o plan eliminado), sólo se retira del panel/Excel, aun cuando el pedido histórico figure abierto. Nunca cambia cantidades, resoluciones, revisiones ni métricas de esa ejecución. Datos y permisos son los de BL-150; auditoría añade `routeRetired`. Bloqueos de plan/publicación preceden a ejecución/parada/pedido/incidencia para serializar cancelación, republicación y eliminación del plan. Validar canceladas pendientes/resueltas, planes eliminados, carreras, idempotencia y compatibilidad de pedidos abiertos/cerrados en rutas activas. Confirmación visual conserva el estilo existente y explica los tres estados.
# BL-151 — miniaturas de producto para el chofer

Chofer autorizado: cada línea del pedido muestra la foto de Odoo y, si falta o no está disponible, el logo Five atenuado. La foto es auxiliar y no condiciona llegada, cantidad, incidencia ni entrega. Se consulta en sólo lectura por la identidad de producto ya importada; nunca por similitud de nombre. Se añade un enlace privado a la respuesta móvil, sin reescribir la publicación. Cachear imágenes pequeñas con tamaño/vida acotados; validar asignación y origen antes de acceder a caché del servidor. Auditoría: no hay mutación de negocio; errores técnicos sin secretos. Validar autorización, publicación obsoleta, origen equivocado, fallback, caché, compatibilidad de APK y regresión de atención.

## BL-152 — corrección de identidad y normalización, sin nuevas reglas operativas

Administrador: quitar/agregar una camioneta conserva el historial pero no reutiliza una revisión publicada, iniciada o retirada. Mantener un máximo durable por plan/camioneta, independiente de la membresía que se borra en cascada; publicar bajo el bloqueo de plan existente. Sin cambiar requisitos de fotos, fecha, asignación, cálculo, inicio, entregas o incidencias; sin reparar ni reescribir rutas activas durante la migración. Conservar auditoría/push y validar concurrencia, rollback, sesión/revisión vieja e historial byte a byte. Chofer: una imagen válida entregada por Odoo con dimensiones superiores al nombre `image_128` se reduce a 128 px antes de mostrarla; conservar límites de entrada/salida, autenticación, privacidad y logo cuando no hay imagen. Validar la foto real que causó el fallo y archivos inválidos/excesivos.
## BL-153 — colores de las métricas del chofer

Pedidos azul, paradas rojo, distancia lima y tiempo dorado: tintar únicamente los cuatro iconos de contorno existentes en «Tu ruta», con la paleta DriverColors; conservar tamaños, etiquetas, valores y acciones.

## BL-154 — regreso a bodega después de la última entrega

BL-155 amplía esta regla: reprogramados son terminales del recorrido y pueden regresar; no se cuentan como entregados. El resto de las protecciones de BL-154 permanece vigente.

Después del recibo y relectura confirmados de la última entrega, ofrecer «Ir a bodega» cuando todos los pedidos publicados estén entregados, sin abiertos, rechazados, reprogramados o reintentos. Comprobar correspondencia completa plan/ejecución/revisión, incluso pedidos sin ubicación. Usar el punto de salida global configurado en el planificador como destino auxiliar de sólo lectura, no como parada/pedido. El mismo botón permanece disponible en el mapa al cerrar el aviso. No iniciar guía automáticamente ni cerrar/liquidar la ruta, registrar llegadas ficticias o cambiar métricas/estados. Sin origen válido o confirmación de servidor no ofrecer destino inventado. Si el origen o la ejecución cambia, invalidar cálculo/guía anterior y permitir nueva acción explícita. Tracking mantiene stopId nulo durante el regreso.

## BL-155 — cierre operativo en bodega y reprogramación remota

Ampliación autorizada: un pedido reprogramado se considera cerrado en este recorrido, no entregado; permite regreso/cierre junto con entregados, siempre sin open/closed_pending/rejected. «Terminar ruta» aparece al validar GPS real, reciente y preciso dentro del radio configurado del punto de salida. Modal «¿Estás seguro de que terminaste tu ruta?» con Aceptar/Cancelar. Aceptar envía comando durable, versionado e idempotente; servidor vuelve a validar sesión/dispositivo/asignación, ejecución, origen, política GPS y todos los pedidos bajo bloqueo. Registrar cierre operativo inmutable con actor/dispositivo/hora/origen/evidencia GPS, detener tracking, conservar pedidos/estados/incidencias/métricas/publicación y liquidación separada. Ejecución terminada queda de consulta y no permite nuevas operaciones del chofer ni iniciar tracking. Repetición recupera un solo cierre. Administrador conserva herramientas de reporte; no hay reapertura automática ni Odoo escritura.

Reprogramar a distancia sólo closed_pending respaldado por una incidencia real de cliente cerrado del pedido/parada/ejecución. No requiere visita activa ni GPS; conserva identidad de visita y controles de revisión/permisos/recibo. Entregar/rechazar/reportar incidencias no obtienen esa excepción: mantienen visita/llegada. Reprogramados conservan su evento e historial y responsabilidad de reasignación administrativa.
