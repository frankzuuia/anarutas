# Incidencias: organización, captura y atención compartida

Estado: bloque IO-T01 aprobado por «dale carnal tokio» el 2026-10-08 y verificado localmente.
Fecha: 2026-10-08. Repositorio: Ana Rutas, rama develop, base 075d63e.
Este documento es el contrato; la evidencia ejecutada se registra por separado.
IO-T02/03/04 autorizados posteriormente por «Sí, continúa con APK y panel»:
ejecución separada con evidencia y entrega a develop; sin despliegue.

## 1. Alcance confirmado por el propietario

Incidencias y su Excel contienen solamente faltante por validación, faltante
desde bodega, reposición por calidad y reposición por producto erróneo.
Devolución se muestra en Incidencias en vivo y se excluye del reporte/Excel.
No se elimina su registro, evidencia, auditoría ni efecto financiero existente.
El propietario registra devoluciones en Odoo por su proceso actual.

El propietario aclaró posteriormente que cuentan las capturas de aquí en adelante:
no recuperar el Odoo vencido ni reclasificar datos antiguos. La migración no cambia
filas históricas; sólo añade soporte para capturas nuevas y anotaciones futuras.
El formato del Excel queda intacto. «Visto» es compartido entre administradores,
con leyenda «Visto por [nombre]». No equivale a Resolver ni a cancelar.
Todo el trabajo se prepara primero en develop; no incluye despliegue, main,
EasyPanel, el proyecto Five ni escrituras en Odoo o llamadas a Google/OpenAI.

## 2. Autopsia del estado actual

| Conexión real | Comportamiento encontrado | Cambio requerido |
| --- | --- | --- |
| `src/core/product-incidents.ts`, `readProductIncidents` | Live sólo devuelve dos reposiciones pendientes; history/export incluyen devoluciones | Selección explícita de cuatro tipos para reporte/export y los cinco para la proyección en vivo |
| `src/core/driver-live-incidents.ts` | Consulta separada de cerrado/rechazado/reprogramado, con reglas de vigencia y reintento | Incorporar al agrupamiento sin cambiar transiciones de los casos |
| `src/core/driver-incidents.ts` | Llegadas tarde y repuntes en otra consulta | Presentarlos en apartados independientes del panel en vivo |
| `src/components/incidents-panel.tsx` | Mezcla productos, reglas GPS y llegadas | Reporte de cuatro tipos; conservar acceso a reglas/repuntes en la vista operativa |
| `src/components/product-incidents-panel.tsx` | Edita departamento/concepto, no comentarios | Editor administrativo con comentarios efectivos e historial |
| `src/core/product-incident-form.ts` y `product-incidents-policy.ts` | Formulario v2 y clasificación obligatoria también para devolución | Contrato nuevo por tipo; compatibilidad con comandos antiguos |
| Android `ProductIncidentSheet.kt`, `ProductIncidentPolicy.kt` | Clasificación incondicional, catálogos compartidos | Reglas y visibilidad por tipo de incidencia |
| Android `RouteServiceSheets.kt` | Selector exterior recorre cuatro opciones | Mostrar sólo cliente cerrado/pedido rechazado |
| Android `DriverApi.kt` y `src/server/product-photos-body.ts` | Transporte multipart exige específicamente v2 | Aceptar también contrato nuevo sin romper fotos múltiples ni colas v2 |
| `src/core/panel-event-stream.ts` | SSE notifica cambios genéricos | Leer novedades por identidad durable; no disparar audio por cada refresh |

Las tablas reales son `route_product_incidents`, `route_driver_service_incidents`
y `route_driver_stop_events`. Existen auditoría de producto, fotos privadas,
recibos idempotentes, bloqueo de ejecución y control de cantidades/saldos.
No existe todavía confirmación compartida de lectura ni configuración de alarma.

## 3. Reglas de negocio y trazabilidad

| Regla | Actor y decisión | Dirección técnica / datos | Permiso y auditoría | Validación |
| --- | --- | --- | --- | --- |
| IO-BL01 | Administrador: reporte/Excel sólo cuatro tipos | Predicado único para filas, conteos, paginación y exportación | Rol de rutas existente; lecturas autenticadas | IO01–03 |
| IO-BL02 | Chofer: selector exterior sólo cerrado/rechazado | Presentación; faltantes permanecen dentro del pedido | Llegada, pertenencia y permisos existentes | IO04 |
| IO-BL03 | Chofer: devolución sin departamento/concepto, foto obligatoria | Contrato por tipo; fotos privadas; notas adicionales | Validar también servidor, conservar recibo y evidencia | IO05–08 |
| IO-BL04 | Chofer: cuatro tipos admiten Error en compra y comentarios solicitados | Catálogos de APK y servidor consistentes; motivo de bodega nuevo | Validación de códigos, sin interpretar texto libre | IO09–11 |
| IO-BL05 | Administrador: editar clasificación y comentarios de las cuatro | Comentario administrativo efectivo separado del original, versión y auditoría | Rol de rutas; actor de sesión; antes/después | IO12–14 |
| IO-BL06 | Administrador: vivo por chofer y tipo, tardanzas abajo | Proyección de fuentes existentes; no duplicar incidencias | Respetar vigencia, evidencia y estados operativos | IO15–17 |
| IO-BL07 | Administrador: Visto para todos con nombre | Registro durable por fuente/ID; primer reconocimiento gana | Sesión, escritura atómica y auditada; idempotente | IO18–21 |
| IO-BL08 | Administrador: alarma 5/10/15 s para nuevas | Preferencia persistida; cursor de novedades; audio y deduplicación en navegador | Cambio de preferencia versionado/auditado; activación local del audio | IO22–29 |
| IO-BL09 | Sistema: compatibilidad e integridad | API nueva acepta v2/legado y v3; no reescribir comandos en cola | Conservar hashes, recibos, cantidades, cobros y aislamiento | IO08, IO14, IO30–33 |

### Catálogos finales de captura nueva

| Tipo | Concepto | Comentarios/motivo |
| --- | --- | --- |
| Faltante por validación | Agregar Error en compra a los existentes | No venía el producto en el pedido; Llegada tardía; notas adicionales |
| Faltante desde bodega | Agregar Error en compra a los existentes | Conservar motivos existentes y agregar No venía el producto en el pedido; notas adicionales |
| Reposición por calidad | Agregar Error en compra a los existentes | Conservar comentarios actuales y notas |
| Reposición por producto erróneo | Agregar Error en compra a los existentes | Conservar comentarios actuales, incluido No venía el producto en el pedido; notas |
| Devolución | No se solicita departamento ni concepto | Sólo No cumple con las especificaciones del cliente, Mala calidad y Producto golpeado; notas adicionales |

Devolución exige de una a tres fotografías válidas, conforme al límite existente.
Sin fotografía lista no se habilita Guardar; enviar por API sin evidencia también
se rechaza. Se conservan validación de imagen, tamaño, privacidad y retención.
Cambiar de tipo limpia sólo selecciones incompatibles de la captura actual, no
reescribe registros históricos. «Error_en_compra» histórico no se migra por texto.
El comentario manual «Llegada tardía» no fabrica un evento GPS de llegada tarde.

### Organización visible

Dentro de cada chofer: Reposiciones, Devoluciones, Faltantes, Cliente cerrado,
Pedido rechazado y Reprogramados. Ocultar grupos vacíos. Mostrar subtipo,
cliente/pedido, producto/cantidad cuando aplica, comentarios, estado y evidencia.
Departamento/concepto permanecen en el reporte; no se muestran en vivo.
Nuevas sin ver primero; orden estable por fecha e identidad dentro de cada grupo.

Llegadas fuera de horario van al final, en un bloque propio por chofer, con su
hora y demora real. Conservar repuntes y reglas de llegada en un apartado
operativo secundario de esa vista; no incluirlos en las cuatro del Excel.
Respetar las reglas actuales de vigencia/reintento de casos. No quitar una tarjeta
por marcar Visto. Los estados finales conservan su tratamiento operativo actual.
Las reposiciones pendientes de planes archivados siguen consultables como hoy.

### Lectura compartida y audio: valores propuestos para aprobar

- La confirmación es unidireccional: primer administrador que marca Visto queda
  identificado; un segundo clic concurrente devuelve la misma confirmación.
- Visto no resuelve, cancela, entrega, reconoce cantidades ni cambia saldo.
  Una edición de comentarios no vuelve a poner roja una incidencia ya vista.
  Una incidencia nueva tiene identidad y confirmación independientes.
- Duración compartida de alarma: 5, 10 o 15 s; valor inicial propuesto: 5 s.
  La preferencia se conserva entre sesiones. Activar/probar sonido es local al
  navegador, porque requiere permiso/interacción del usuario.
- Sonar por nuevas incidencias autorizadas de la vista, incluidas tardanzas.
  Los filtros visuales no deben esconder una alerta: indicar novedades fuera del
  filtro con acceso para mostrarlas. Cambiar filtros/páginas no genera alarmas.
- Una ráfaga suena una vez durante el tiempo configurado; no superponer sonidos
  ni prolongar indefinidamente. Si todos los eventos de esa ráfaga se marcan
  vistos, detenerla al recibir la confirmación compartida.
- Un coordinador por origen/sesión evita multiplicar audio entre componentes y
  pestañas del mismo navegador. PCs distintas conservan su aviso local hasta
  recibir Visto. No se promete exactamente una reproducción ante caída del
  proceso justo entre reservar una alerta y emitir sonido; el rojo durable es
  la garantía de recuperación.
- El histórico previo al cambio se conserva sin alarma retroactiva y sin inventar
  un administrador que lo vio. Las nuevas posteriores al corte llevan rojo
  hasta Visto. El corte no puede borrar ni marcar visto el histórico.
- La primera apertura lista pendientes; no reproduce todo el histórico. Una
  reconexión durante monitoreo recupera novedades no recibidas, incluso más de
  una página. Un comando offline recién recibido cuenta por registro en servidor,
  no sólo por su fecha de captura en teléfono.
- Mostrar Sonido activo/bloqueado/sin conexión según estado comprobado. No afirmar
  que hay alarma garantizada con navegador cerrado, PC suspendida o desconectada.

## 4. Diseño técnico propuesto (nombres nuevos por fijar al implementar)

### A. Contratos y reporte

Introducir formulario v3 por tipo y aceptar v2/legado sin cambiar sus hashes ni
recibos. Auditar todos los chequeos de formVersion, no sólo el formulario visible.
API nueva primero; APK después. No emitir v3 contra backend anterior.

El filtro de cuatro tipos vive en el servidor, compartido por reporte y export.
El exportador `product-incidents-excel.ts` mantiene las nueve columnas:
Fecha, Cliente, Producto, Cantidad, Unidad, Departamento, Detalle de la incidencia,
Comentarios, Orden. Conservar hoja/tabla Incidencias, tipos, anchos, estilo,
filtros, formato decimal/fecha, escape de fórmulas y precisión existente.

Agregar comentario administrativo opcional separado del original. Null significa
usar comentario del chofer; texto vacío explícito significa comentario efectivo
vacío. Lecturas del reporte, vivo y Excel usan el efectivo. La clasificación
conserva versión, bloqueo y antes/después; el original y sus comentarios rápidos
siguen auditables. Una modificación posterior del chofer no borra la corrección
administrativa. No aceptar cantidad/precio/estado como parte de esta escritura.

### B. Proyección en vivo y notificaciones

Unificar presentación mediante identidad compuesta fuente+ID. La incidencia
original sigue siendo la fuente de verdad; no duplicar filas de negocio.
Mantener consultas paginadas, filtros autenticados y conteos del conjunto completo.
La lista visible no debe servir como detector de novedades: sus primeras 50
filas no garantizan cobertura de todos los choferes ni de una reconexión.

Migración aditiva para reconocimientos compartidos, preferencia de alarma y
registro durable de novedades. Usar FK a la fuente real y restricción de una sola
fuente por registro, unicidad por identidad y referencias al administrador.
Actor/nombre/hora salen de sesión/servidor; nunca confiar en actor enviado por UI.
Insertar novedad en la misma transacción que crea la incidencia. Un rollback o
replay no emite otra novedad. Indexar identidad, pendientes y lectura incremental.

No usar MAX(bigserial) sin protección como cursor de confirmación: transacciones
pueden confirmar en distinto orden y perder eventos. Definir y probar orden de
confirmación seguro, por ejemplo serialización de la asignación final de secuencia
con lock transaccional común. Auditar jerarquía de locks antes de elegir mecanismo;
Visto no tomará bloqueos financieros/de ejecución. Prueba obligatoria de dos
transacciones con confirmación invertida. Corte histórico consistente en migración.

SSE existente sólo acelera la relectura autenticada; un cambio genérico no suena.
Conservar recuperación por reconexión/foco y consultas de reparación existentes.
Difundir Visto mediante el canal existente; respuesta del servidor es canónica.
El navegador usa coordinación entre pestañas sólo donde las APIs estén disponibles;
si falta soporte, degradación explícita con rojo funcional, sin promesa falsa de audio.

### C. Permisos, fallos y recuperación

Reutilizar principal, rol routes, controles de origen/JSON, errores sanitizados y
aislamiento de la instalación. No exponer archivos de evidencia ni secretos en
eventos, logs o almacenamiento de coordinación. Respuestas 401/403 no actualizan
preferencias ni Visto. Una cuenta revocada deja de recibir información.
Ante timeout del marcado, releer/reintentar la misma identidad; no revertir una
confirmación ya guardada. Ante conflicto de edición, mostrar versión actual sin
sobrescribir. Una desconexión nunca marca nada como visto automáticamente.

Migraciones nuevas, no reescribir las históricas. Preservar triggers de integridad
y auditoría financiera al ampliar metadatos. La reversión de código requiere
compatibilidad con esquema aditivo; después de desplegar APK v3 no volver a API
que sólo acepta v2. No borrar novedades/confirmaciones para revertir una pantalla.

## 5. Matriz de escenarios de aceptación

Cada fila se convertirá a Gherkin/prueba correspondiente. Entorno: PostgreSQL real,
HTTP local autenticado y navegador/Android reales cuando aplique; sin mocks.

| ID | Actor / precondición / disparador | Resultado y datos | Auditoría / efecto | Validación / recuperación |
| --- | --- | --- | --- | --- |
| IO01 | Admin consulta cinco tipos | Reporte, conteos y Excel sólo cuatro | Lectura; cero borrados | SQL real con cada tipo y canceladas |
| IO02 | Admin exporta tras filtrar | Mismas filas del conjunto completo; nueve columnas intactas | Sólo descarga | Reabrir XLSX, formato, tipos, fórmulas y >50 filas |
| IO03 | Admin consulta devolución histórica | En vivo según vigencia, evidencia y efectos conservados | Ninguna mutación de negocio | Comparar identidad/cantidad/saldo |
| IO04 | Chofer llegado abre selector exterior/interior | Exterior dos tipos; interior conserva cinco | Sólo selección | JVM/UI y permisos de llegada |
| IO05 | Chofer crea devolución sin foto | No guardar en APK; API rechaza | Ninguna incidencia/recibo parcial | HTTP y Android sin foto/corrupta/exceso |
| IO06 | Chofer crea devolución válida | Sin clasificación; tres comentarios permitidos y notas | Incidencia+evidencia+recibo atómicos | Fotos 1/2/3 reales; rechazo de campos incompatibles |
| IO07 | Chofer cambia tipo/editando historial | Selecciones incompatibles no se filtran al nuevo tipo; originales intactos | Cambio versionado cuando se guarda | Regreso de tipo y fotos existentes |
| IO08 | APK antigua reenvía v2 pendiente | Recibo exacto, fotos múltiples, sin duplicar | Idempotencia existente | Legado/v2/v3, replay y fallo de upload |
| IO09 | Chofer usa Error en compra en cuatro tipos | Catálogo consistente APK/API | Registro normal | Contratos TS/JVM; dato histórico preservado |
| IO10 | Chofer usa motivo nuevo de bodega | Persistencia, detalle y export correctos | Registro normal | Restricción SQL y etiquetas |
| IO11 | Chofer elige Llegada tardía manual | Comentario, no evento automático de GPS | Ninguna novedad adicional | Comparar número/identidad de eventos |
| IO12 | Admin corrige clasificación/comentario | Efectivo coincide en reporte, vivo y Excel | Antes/después y actor | Guardar, recargar, original recuperable |
| IO13 | Dos admins editan misma versión | Uno guarda; otro recibe conflicto | Sin actualización perdida | Dos conexiones PG/HTTP reales |
| IO14 | Admin intenta editar cantidad/cobro o retorno | No amplía alcance del editor de cuatro tipos | Rechazo; saldo intacto | Campos extra, permisos y regresión financiera |
| IO15 | Varios choferes/tipos en vivo | Agrupación correcta sin duplicados | Sólo lectura | Conteos globales, paginación y filtro |
| IO16 | Evento real de llegada tarde/repunte | Tardanzas abajo, repuntes separados, reglas accesibles | Sin recalcular ni editar GPS | Evidencia temporal y navegación panel |
| IO17 | Caso en reintento/resuelto/plan archivado | Reglas operativas preservadas; Visto independiente | Cero transiciones implícitas | Regresiones de servicio/publicación |
| IO18 | Admin marca Visto | Rojo desaparece para todos, nombre real persiste | Reconocimiento auditado | Dos sesiones y recarga |
| IO19 | Dos admins marcan simultáneamente | Primer actor queda; segundo recibe mismo estado | Una confirmación canónica | Concurrencia PG real |
| IO20 | Timeout después de guardar Visto | Reintento no duplica ni cambia actor | Mismo reconocimiento | HTTP y reconexión |
| IO21 | Sesión ajena/revocada intenta Visto | Rechazo, sin lectura/escritura no autorizada | Error sanitizado | Autorización, origen y aislamiento |
| IO22 | Incidencia nueva con sonido activo | Rojo y ráfaga 5/10/15 s | Una novedad por fuente/ID | Tiempo Web Audio, preferencias persistidas |
| IO23 | Refresh, editar, paginar o marcar Visto | No vuelve a sonar el mismo evento | No crea novedad de creación | Navegador real y mutación del detector |
| IO24 | Dos pestañas/componentes reciben cambio | Sin audios superpuestos en mismo navegador | Coordinación local | Dos pestañas, cierre y recuperación del coordinador |
| IO25 | Varias incidencias llegan juntas | Una ráfaga acotada; todas rojas | Todas las novedades conservadas | Concurrencia y duración sin crecimiento ilimitado |
| IO26 | Browser bloquea audio | Estado explícito, botón activar/probar; rojo funciona | No fingir reproducción | Perfil sin permiso/gesto, activación real |
| IO27 | Reconexión con >50 novedades | Recuperar todas sin depender de página visible | Cursor durable | Interrupción SSE/HTTP y paginación |
| IO28 | Comando offline con fecha antigua llega nuevo | Notificación por recepción real | Una novedad al commit | Fecha captura distinta de fecha inserción |
| IO29 | Instalación inicial con histórico | Histórico silencioso, no inventar Visto por alguien | Corte explícito | Migración con datos existentes |
| IO30 | Dos inserciones intentan confirmar fuera de orden | No saltar ningún evento por cursor | Registro atómico | Prueba concurrente de orden de commit |
| IO31 | Inserción rollback/replay/cancelación | Sin novedad fantasma; cancelar no revive rojo | Auditoría/recibos conservados | Fallo transaccional y reintento |
| IO32 | Migración reiniciada y API compatible | Esquema consistente, datos conservados | Versión migración existente | Instalación limpia+upgrade real; introspección |
| IO33 | Pedido con incidencia y cobro/liquidación | Cantidad, moneda, saldo, recibos e historial iguales | Sin modificación financiera por Visto/comentario | Regresión crítica de entrega y liquidación |

## 6. Bloques propuestos y puertas de salida

1. **IO-T01 — contratos y reporte (IO-BL01/03/04/05/09).** Catálogos/formulario
   compatible, ampliación aditiva del motivo, comentario administrativo auditado,
   filtro de cuatro tipos, contratos multipart y regresiones Excel/financieras.
   Todavía no cambiar navegación Android ni activar alarmas.
2. **IO-T02 — APK (IO-BL02/03/04/09).** Selector exterior, formulario por tipo,
   comentarios, fotos y cola compatible. Pruebas JVM, compilación y QA físico
   disponible; documentar cualquier limitación física, no declararla aprobada.
3. **IO-T03 — panel y monitoreo (IO-BL05/06/07/08/09).** Editor, agrupación,
   tardanzas, persistencia de Visto/novedades/configuración y audio coordinado.
   Pruebas de migración, permisos, carreras, reconexión y dos administradores.
4. **IO-T04 — integración y entrega (todas).** Gherkin, QA reproducible, cobertura,
   mutaciones, seguridad/supply chain, regresión, documentación y develop una vez
   verdes las puertas aplicables o con excepción explícita. Sin deploy.

Objetivos de validación (aún no medidos): 100% de ramas nuevas de permisos,
foto obligatoria, selección de cuatro tipos y reconocimiento idempotente; >=90%
en módulos modificados y 100% de escenarios críticos aunque el promedio cumpla.
Mutation score >=90% del código nuevo crítico y cero sobrevivientes que violen
esas invariantes; justificar equivalentes. Complejidad: medir funciones tocadas,
no aumentar el mayor punto sin revisión explícita. Cero defectos críticos/altos
abiertos ni regresiones financieras. Reportar errores, cobertura y latencia
p50/p95 de lectura/Visto bajo carga documentada, sin inventar un SLO medido.
Meta de propagación con conexión sana: <=2 s p95; reparación por sondeo existente
se mide por separado. Audio medido por reloj de audio, tolerancia de QA <=0.5 s.

Comandos oficiales observados: npm run typecheck, npm run lint, npm test,
npm run test:coverage, npm run test:mutation, npm run build, npm run test:e2e.
Seleccionar suites afectadas y configuración de mutaciones acotada antes de
ejecutar. Descubrir comandos Gradle/dispositivo al entrar al bloque Android.
Pruebas existentes de partida: product-incidents*, product-incident-form*,
product-incident-photos*, driver-service*, E2E product-incidents y sus homólogos
ProductIncidentPolicyTest/ProductPhotoUploadTest/IncidentCaptureStoreTest JVM.

## 7. Compatibilidad documental y referencias

Esta propuesta sustituirá sólo al aprobarse: selección de tipos del reporte/live
de BL-145; catálogo obligatorio compartido de BL-147/149; composición de pantallas
de AI19. Mantiene BL-144/146/148/150, finanzas BL-157..161 y transiciones BL-112..114.
La excepción de devolución sin clasificación se limita al contrato nuevo; fotos,
cantidades y permisos no se relajan. No altera el layout del Excel BL-145/147.

Revisión local: reglas IO-BL01..09 enlazadas a tareas IO-T01..04 y escenarios
IO01..33. Especificación coherente para revisión del propietario; no confundir
esta comprobación documental con evidencia de implementación o producción.
La arquitectura de secuenciación/locks se verificará en B3 antes de crear SQL.

Referencias consultadas:
- Código y migraciones locales citados en secciones 2 y 4, esquema actual hasta v45.
- [Chrome: autoplay y Web Audio](https://developer.chrome.com/blog/autoplay).
- [MDN: Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
- [MDN: Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API).
- Documentación Next instalada bajo node_modules/next/dist/docs antes de tocar rutas/UI.

IO-T01: contratos y migración implementados y verificados en entorno local aislado.
Resultados y límites en QA-INCIDENCIAS-BLOQUE1-2026-10-08.md. No se han ejecutado
migraciones remotas. Los demás bloques y el despliegue siguen pendientes.
