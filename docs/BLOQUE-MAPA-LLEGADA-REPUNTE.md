# Mapa, llegada y repunte del chofer — propuesta del primer bloque

Fecha: 24/09/2026. Base inspeccionada: `develop`, `c7a0bca`.
Estado: bloque y parámetros aprobados con «dale» el 24/09. Construcción en curso;
no desplegado ni certificado para producción.

## 1. Alcance confirmado y límites

- Abrir el mapa después del inicio confirmado de la ruta, conservar el diseño
  Five existente, mostrar posición, paradas y destino activo con datos reales.
- Habilitar «Llegué» por cercanía; registrar llegada/inicio de atención, nunca
  entrega completada. Abrir una ficha inferior con los pedidos y productos reales.
- «Mal punteado» permite mover el marcador y confirmar la corrección. El usuario
  confirmó que se aplica inmediatamente a su ruta y al cliente para rutas futuras,
  sin aprobación administrativa intermedia.
- Registrar repuntes como incidencias reales. Incidencias se consulta por fecha y
  chofer, combinando ambos filtros y manteniéndolos al actualizarse en vivo.
- No mover el orden de los pedidos ni las rutas ya publicadas de otras unidades.
  No escribir en Odoo; la ubicación corregida pertenece a Ana Rutas.
- Devoluciones, cobros, comprobantes, evidencia de entrega y finalización de
  entrega quedan fuera. Tampoco se incorpora rastreo histórico continuo de GPS.

## 2. Autopsia comprobada

| Pieza real | Estado observado | Consecuencia para este bloque |
| --- | --- | --- |
| `driver-app/.../DriverViewModel.kt`, `startRoute` | Confirma inicio y vuelve a Ruta | Abrir mapa mediante un evento consumible, sin repetir aperturas por SSE/recomposición |
| `RouteNavigationActivity.kt` | Navigation SDK 7.9.0; `ArrivalListener` y cursor local; el mapa previo sólo añade un marcador | Añadir todas las paradas y estado operativo de servidor; no confundir callback del SDK con llegada del negocio |
| `NavigationProgress.kt` | Cursor por plan/revisión en preferencias | Mantener separado de la llegada persistida y reconciliar tras recreación/retiro |
| `route_plan_publications` y sus guardas | Snapshot iniciado inmutable; cancelación revoca y cambia revisión | Añadir ejecución separada, sin desactivar guardas ni modificar pedidos iniciados |
| `route-publication-content.ts` | Snapshot con pedidos, coordenadas y ventanas, sin identidad/versionado de cliente explícitos | Resolver identidad usando `route_shipments.source/partner_id`, nunca nombre ni coordenada |
| `customers-schema.ts` | Admite `driver_confirmed` e historial `source=driver`, pero `updated_by` referencia un usuario admin | Incorporar autor chofer explícito; no colocar driver ID en una FK de administradores |
| `driver-mobile-events.ts` | Huella sólo de publicación, unidad, revisión e inicio | Agregar revisión operativa propia; repunte/llegada deben invalidar lecturas sin generar otro push de nueva ruta |
| `incidents-panel.tsx`, `dashboard.tsx` | Pantalla estática, sin consulta ni invalidación para incidencias | Implementar consulta real y conectar la sección al refresco SSE existente |
| `/api/plans/:id/incidents` | Consulta de pronósticos, no de sucesos del chofer | Conservar contrato; crear consulta distinta para incidencias reales |
| BuildConfig release local de APK 0.4.0 | `NAVIGATION_API_KEY` vacía | Falta clave Android restringida y prueba real; Firebase no sustituye esta configuración |

Los documentos históricos que dicen «APK pendiente» no describen el estado actual.
Este bloque sustituirá únicamente esas restricciones de captura de BL-063/100/101;
no cambia la separación entre previsión, llegada, surtido y entrega.

## 3. Reglas propuestas para confirmar

### BL-105 — mapa y ejecución propia

Actor: chofer autenticado. Tras inicio confirmado, mapa de su ejecución vigente
con todos sus destinos, posición actual, próxima parada y ficha inferior.
Permiso: asignación activa y publicación iniciada no revocada; el servidor vuelve
a comprobarlo en cada comando. Datos: snapshot publicado más estado operativo,
sin cambiar su orden. Auditoría: apertura no genera eventos de negocio; mutaciones
sí. Validación: arranque, reapertura, rotación, retirada, reconexión y medianoche.

Se distinguen paradas de atención por cliente/domicilio y puntos de navegación.
Pedidos contiguos del mismo contacto de entrega comparten parada; clientes
distintos en la misma coordenada conservan identidad y atención separadas.
Visitas no contiguas no se fusionan. La UI muestra cantidades de pedidos y paradas
por separado; seleccionar destino nunca reordena ni marca entregas.

### BL-106 — llegada verificable

Actor: chofer de esa ejecución. Propuesta inicial: radio de **100 m**, precisión
máxima de **50 m** y muestra de antigüedad máxima **30 s**, configurados en servidor
y entregados a la APK; no constantes de negocio dispersas. Radio editable por
administrador en configuración operativa, con versión y auditoría.

La muestra debe ser finita, dentro de rangos geográficos, precisa, reciente y no
marcada por Android como simulada. Se usa ubicación sin ajuste a carretera para
proximidad al domicilio. Criterio conservador propuesto: distancia geodésica más
incertidumbre horizontal no excede el radio. La API recalcula la distancia;
no acepta un booleano `nearby` ni una distancia calculada por el cliente.

La precisión declarada por Android es estimación, no prueba antifraude absoluta.
Una APK manipulada puede falsificar datos: registrar este riesgo sin prometer que
la validación de radio elimina toda suplantación. No habilitar GPS simulado.

El botón muestra por qué no está disponible (distancia, permiso, señal, conexión
o ruta retirada). Al confirmar, servidor guarda hora real de recepción,
zona, muestra, distancia, radio/versiones y ventanas publicadas utilizadas.
Un toque repetido devuelve el mismo evento y la misma hora. Reabrir la ficha no
crea otra llegada. La atención queda iniciada, sin completar productos/entrega.

Datos y auditoría: evento de llegada inmutable vinculado a ejecución/parada y
pedidos; `mobile.stop.arrived`. Permiso: no acepta chofer/cliente arbitrarios en
el cuerpo. Validación: fronteras del radio, GPS obsoleto, reloj alterado, doble
toque, permisos, aislamiento y carreras contra cancelación/repunte.

### BL-107 — repunte inmediato y permanente

Actor: chofer con parada propia en ejecución vigente. Abrir editor, mover el pin
o usar ubicación actual y confirmar mostrando antes/después. No exigir cercanía
al pin antiguo, porque puede estar equivocado. Propuesta: exigir GPS reciente y
cercanía al NUEVO pin con la misma política de proximidad para evitar correcciones
remotas accidentales. No limitar artificialmente la distancia antiguo→nuevo.

Una transacción aplica la coordenada a esa parada/cliente de la ejecución,
actualiza `route_customers` a `driver_confirmed`, incrementa versión del cliente
y de ubicación, inserta historial e incidencia con autor real. Mantiene nombre,
teléfono, ventanas y pedidos. En 0.5.1, confirmar el nuevo pin abre un modal
para calle y número, colonia, código postal y ciudad. Cerrar el modal no guarda
el punto. Sólo la confirmación final envía las cuatro partes: la dirección
formateada actualiza cliente y ejecución propia de forma atómica, y su antes/
después queda en la incidencia. No se adivina una dirección mediante
geocodificación. Una APK anterior que omite la dirección conserva su contrato.
El `place_id` anterior no se conserva si ya no identifica el nuevo pin. El
enlace de mapa se regenera.

El editor recibe la versión actual del cliente además de la versión operativa.
Ediciones concurrentes devuelven conflicto: recargar, comparar y confirmar de
nuevo; nunca sobreescritura silenciosa. Mismo comando no duplica historial ni
incidencia. Una confirmación sin cambio no produce efectos ni consultas Google.

Sólo se corrige ese contacto de entrega, no su matriz comercial ni clientes
distintos que compartan coordenada. Otras publicaciones mantienen sus snapshots.
Los borradores/futuras publicaciones consumen el dato actualizado por los flujos
existentes; no se lanza optimización global ni republicación automática.
Si ya hubo llegada, su hora/punto histórico permanecen intactos.

Auditoría: `mobile.stop.repointed`, ubicación anterior/nueva, cliente, parada,
pedidos, plan, unidad, chofer, fecha/hora y clave idempotente. Validación:
rollback total, concurrencia entre dos choferes/admin, sincronización Odoo sin
pisar el dato local y aislamiento de otras rutas.

### BL-108 — incidencias por fecha y por chofer

Actor: administrador autenticado. Filtros combinables: fecha inicial/final y
chofer, con «Todos los choferes»; inicio en hoy según zona de la instalación.
La fecha de filtro es la fecha real del evento, no la fecha del plan. Mostrar
también fecha de servicio para evitar confusión en rutas que cruzan medianoche.

Lista cronológica descendente paginada por cursor estable, orden hora+ID;
filtros se aplican en SQL antes de paginar. Choferes posteriormente desactivados
siguen consultables si tienen historial. Cada fila conserva nombres históricos
de cliente/chofer/unidad, pedidos, hora y tipo; detalle de repunte antes/después.
SSE invalida la consulta preservando filtros; una respuesta de filtros anteriores
no puede reemplazar la selección actual. Diferenciar vacío, error y desconexión.

Tipos del bloque: ubicación corregida y retraso real al llegar, no pronósticos
Google. La llegada puntual se conserva como evento, pero no se convierte en
incidencia. Regla propuesta de ventanas múltiples: si existe recepción abierta
o posterior ese día, no declarar retraso definitivo; después del último cierre,
retraso = llegada - último cierre. En el cierre exacto, cero; sin ventanas, sin
retraso calculable. Las ventanas son las publicadas y se congelan en el evento.
No reinterpretar el histórico con cambios posteriores de horarios.

Permiso: sesión admin existente, aislamiento por instalación. Consulta no muta
ni genera llamadas Google/Odoo. Auditoría de origen en el comando móvil.
Validación: fecha/zona/medianoche, filtros combinados, historial, paginación,
datos modificados después, SSE/reconexión, permisos e inyección.

## 4. Contratos técnicos aprobados (implementados localmente en esquema20)

### Persistencia

- `route_driver_executions`: una ejecución por plan/unidad/revisión publicada,
  inicio y revisión operativa. No reutilizar la ejecución de una ruta cancelada
  al republicar. Crear al iniciar; migración idempotente para rutas ya iniciadas,
  sin fabricar llegadas. Validar identidad real de pedidos/clientes al migrar.
- `route_driver_execution_stops`: IDs estables de paradas, membresía de pedidos,
  contacto de entrega, punto base y efectivo, versión y estado de llegada.
- `route_driver_stop_events`: append-only; llegada/repunte, hora UTC, fecha local
  y zona congeladas, autor móvil/dispositivo, datos originales necesarios para
  auditoría y retraso, referencias/snapshots históricos. No borrar por cascada
  la evidencia cuando se retire/elimine un borrador.
- Recibos idempotentes por dispositivo/comando: huella del cuerpo y resultado,
  clave repetida con cuerpo distinto rechazada. Restricción adicional de una
  llegada por ejecución/parada, incluso usando distintas claves/dispositivos.
- Configuración operativa versionada para radio, precisión y antigüedad;
  validación servidor y UI, políticas guardadas en cada evento.
- Extender autoría de cliente/historial para distinguir admin y chofer con FK y
  restricciones; mantener `created_by`. No atribuir la edición al admin anterior.
- Índices para fecha+chofer+hora+ID, ejecución vigente y claves idempotentes.
  Migración aditiva desde esquema 19, sin DROP de evidencia ni cambios productivos.

### APIs nuevas propuestas

| Contrato | Función / autoridad |
| --- | --- |
| `GET /api/mobile/plans/:id/execution` | Sólo ejecución propia vigente, paradas, política, versiones y estado; sin DML |
| `POST /api/mobile/plans/:id/stops/:stopId/arrival` | Comando de llegada; ejecución/revisión esperadas, clave idempotente y muestra GPS |
| `POST /api/mobile/plans/:id/stops/:stopId/location` | Repunte; mismos controles más versión actual del cliente y nuevo pin |
| `GET /api/incidents` | Incidencias reales por `from`, `to`, `driverId`, cursor; no reemplaza endpoint de pronósticos |
| `GET/PUT /api/driver-operation-settings` | Política operativa; escritura sólo admin, CSRF existente y versión esperada |

Las rutas son decisiones de diseño, no supuestas APIs instaladas. Reutilizar
`mobilePrincipal/mobileBody`, `principal/endpoint/json`, validadores y
transacciones reales; no introducir autenticación paralela ni poner tokens en URL.
Contratos privados sin caché compartida, errores consistentes y cuerpos acotados.

Orden transaccional: plan → publicación → ejecución/parada → cliente. Respetar
locks ya existentes y serializar con cancelación. La publicación se bloquea para
validar, no se modifica su snapshot iniciado. Resolver propiedad/actor en servidor;
verificar chofer/acceso activos dentro de la operación. La misma clave ya
confirmada recupera su recibo autorizado antes de volver a validar la frescura del
GPS; así un timeout no obliga a crear otra llegada.

Cancelación concurrente: si gana, rechazar comando nuevo; si el comando confirma
primero, conservar su historial aunque luego se retire la ruta. Una ejecución
nueva no hereda llegadas de otra revisión. Acceso revocado nunca devuelve datos
por conocer una clave idempotente.

### Flujo y tiempo real

1. Inicio transaccional existente → ejecución → respuesta → apertura única del mapa.
2. GPS reciente → elegibilidad local; toque → comando autenticado → validación SQL.
3. Commit de llegada/repunte → evento + revisión operativa → señal PostgreSQL.
4. Admin relee incidencias filtradas; APK relee estado de su propia ejecución.
5. Ficha de atención se abre sólo con llegada confirmada; timeout se reconcilia
   con el recibo. FCM sigue reservado a publicar/retirar rutas, no a cada GPS.

La Activity del mapa debe participar en reconexión, revocación y recuperación,
no depender de que MainActivity siga visible. Datos antiguos no pueden ganar a
un repunte/retiro reciente. GPS se observa mientras se usa la función; no guardar
trayectorias ni mantener suscripciones abandonadas. Al cruzar medianoche, un
mapa ya abierto sigue vinculado a su ejecución autorizada; no inicia otra ruta ni
reutiliza sus fotos para una salida nueva. Si hay varias rutas, selección explícita.

### Costos, navegación y estados degradados

- Ningún tick de GPS, SSE, filtro, llegada o movimiento del pin solicita Routes,
  Fleet Routing o geocodificación. Movimiento del pin es vista previa local.
- Propuesta: guía hacia un destino activo a la vez, manteniendo todos los puntos
  publicados en vista general. Evita reenviar hasta 25 destinos cuando cambia uno.
  Solicitar destino sólo al comenzar guía, elegir siguiente o confirmar repunte
  del destino guiado; una solicitud en vuelo por clave de destino/versión.
- El Navigation SDK puede adaptar calles por tráfico/desvíos; eso no reordena los
  pedidos. Sus maniobras y ETA son reales, no textos de muestra. No prometer que
  una llamada modifica solamente un segmento interno de Google.
- Tras repunte, el recorrido/ETA publicados no se presentan como recalculados.
  Dibujar guía vigente al destino corregido; retirar o etiquetar la geometría
  anterior como plan original. No inventar líneas viales ni métricas globales.
- Si la guía falla después del commit, la corrección permanece y la app permite
  reintentar navegación sin guardar otra incidencia. No recalcular otras unidades.
- Sin internet/GPS: mostrar estado real; no confirmar llegada/repunte offline ni
  retrofecharlo con el reloj del teléfono. Tras timeout ambiguo, reconciliar el
  recibo antes de reenviar. Si no hubo commit, obtener una muestra nueva y confirmar.
- Clave restringida por paquete/certificado, API/billing de develop y avisos
  obligatorios de Google pendientes. No habilitar servicios/costos externos ni
  cambiar credenciales sin confirmar esa configuración; no imprimir secretos.

## 5. Matriz de escenarios

Todos los escenarios heredan los permisos/actores y datos definidos arriba.
«PG/API» significa PostgreSQL aislado y handlers HTTP reales, no mocks de red.

| ID | Actor / condición / disparo | Resultado / datos y auditoría | Integración / efecto y recuperación | Validación / tarea |
| --- | --- | --- | --- | --- |
| ML01 | Chofer confirma inicio | Ejecución única y mapa, misma secuencia | Inicio/fotos existentes; error no abre mapa falso | PG/API/Android; T01,T02,T05 |
| ML02 | Chofer abre/rota/regresa al mapa | Todos los puntos, destino estable, sin nueva llegada | SDK y lectura propia; no duplicar guía/listeners | Android/dispositivo; T05,T06 |
| ML03 | Chofer dentro/fuera del radio | Sólo muestra válida habilita; API verifica de nuevo | GPS no ajustado; sin llamada de rutas por tick | Unidad límites/PG/API; T03,T05 |
| ML04 | GPS viejo, aproximado, negado o simulado | Rechazo legible sin evento ni entrega | Pedir permiso preciso/esperar señal; no bypass | Android/seguridad; T03,T05 |
| ML05 | Doble toque o respuesta perdida | Una llegada/hora; recibo recuperable | Sin evento ni efecto Google duplicado | PG concurrente/API; T03,T08 |
| ML06 | Otro chofer, sesión revocada, IDs manipulados | 401/404 según contrato, cero escritura/filtración | Autenticación real; fin de sesión | API/seguridad; T02,T03,T04 |
| ML07 | Chofer confirma repunte válido | Punto propio+cliente+historial+incidencia atómicos | Un destino de guía si activo; rollback no notifica | PG/API/SDK real; T04,T06 |
| ML08 | Pin antiguo muy lejos / nuevo lejos del GPS | Antiguo no bloquea; nuevo requiere presencia | Editor libre, guardar validado; conservar borrador local | Unidad/Android/API; T04,T05 |
| ML09 | Dos choferes/admin editan cliente | Versiones detectan conflicto, no pérdida silenciosa | Releer antes de nueva confirmación | PG concurrente; T04,T08 |
| ML10 | Cancelar compite con llegada/repunte | Orden serializable; evidencia confirmada perdura | SSE/FCM de retiro existentes; cerrar guía | PG/API/Android; T02,T04,T06 |
| ML11 | Cancelar y republicar | Nueva ejecución, sin llegadas heredadas | Pedidos/fotos se conservan como BL-104 | Regresión PG/API; T01,T02 |
| ML12 | Varios pedidos/contactos en un punto | Agrupar sólo misma visita/contacto; no cruce | Marcadores compartidos distinguibles, sin reorder | Unidad/Android; T01,T05 |
| ML13 | Repunte con otras rutas publicadas | Sólo overlay propio; futuro cliente actualizado | Sin optimización/push de otras unidades ni DML Odoo | PG/regresión sincronización; T04,T06 |
| ML14 | Llegada tras repunte / repunte tras llegada | Validar punto vigente; historia previa intacta | Refresco por revisión operativa | PG/API; T03,T04 |
| ML15 | Llegada puntual/tardía/cierre exacto/sin ventana | Sólo tarde genera incidencia; ventana congelada | Ninguna ETA se convierte en hecho | Unidad/PG; T03,T07 |
| ML16 | Varias ventanas/cambio de día/reloj alterado | Regla explícita; hora servidor y fecha evento | No rehacer histórico con horario nuevo | Unidad/API; T03,T07 |
| ML17 | Admin fecha+chofer/paginación | SQL filtrado, orden estable, nombres históricos | Sin Google; consulta validada y sin datos cruzados | PG/API/E2E; T07 |
| ML18 | SSE con filtro activo/reconexión | Nuevo evento aparece sólo si corresponde | Conservar filtros, descartar respuesta obsoleta | HTTP/E2E; T02,T07 |
| ML19 | Sin red/Google rechaza/clave ausente | No éxito ficticio; resultado guardado no se pierde | Reconciliar recibo; reintento explícito de guía | Contrato real/Android/físico; T05,T06,T08 |
| ML20 | Rutas existentes y APK anterior | Backfill sin arribos inventados; APIs previas funcionan | Migración idempotente, despliegue backend primero | PG/migración/contrato; T01,T08 |
| ML21 | Admin cambia política durante un comando | Versión detecta cambio; aplicar política vigente | Releer política, mostrar causa, sin llegada forzada | PG/API/Android; T01,T03 |
| ML22 | Plan retirado/eliminado o chofer inactivo | Historial de incidencias no desaparece | Referencias históricas sin cascada destructiva | PG/E2E; T01,T07 |

## 6. Ejecución por pasos y puertas

- ML-T00: auditar base, contratos/documentación oficial y decisiones de negocio;
  confirmar este bloque y parámetros antes de implementar.
- ML-T01: migración/política/autoría/ejecución y agrupación estable; pruebas reales
  de backfill, rollback, duplicados, restricciones e historial conservado.
- ML-T02: lectura operativa autenticada y revisión SSE; reconciliar cancelación,
  reapertura y APK anterior sin ampliar FCM.
- ML-T03: comando de llegada, proximidad/ventanas/hora, idempotencia, contratos y
  pruebas de límite/carreras/permisos.
- ML-T04: repunte transaccional e historial de cliente, incidencia y versionado;
  probar efectos propios, otros clientes/rutas y sincronización de Odoo.
- ML-T05: mapa/ficha/editor premium con componentes Five existentes, apertura
  única, accesibilidad/teclado, ubicación precisa y estados de red/permisos.
- ML-T06: guía dirigida al destino, deduplicación, errores, retiro en mapa y
  recursos/listeners; integración Google real sólo con configuración autorizada.
- ML-T07: consulta y panel Incidencias con fecha/chofer, configuración de radio,
  paginación e invalidación SSE; E2E con filtros y concurrencia de respuestas.
- ML-T08: Gherkin, unitarias/PG/HTTP/E2E/seguridad, cobertura y mutación dirigidas,
  tipos/lint/build, APK firmada, QA reproducible y métricas; registrar resultados,
  no convertir pendientes en verde. Despliegue manual del usuario.

Objetivos propuestos por riesgo: 100 % de decisiones críticas identificadas
(propiedad, revisión, rango GPS, idempotencia y atomicidad) con escenarios
positivos/negativos; >=95 % líneas y >=90 % ramas de la lógica nueva pura de
servidor/Android. Mutation score >=90 % en esa lógica, cero supervivientes
críticos sin justificar; medir aparte UI y total, nunca confundirlos.
Pruebas de regresión de cancelación, fotos diarias, push, orden manual y sesión.
Reportar complejidad por función y separar políticas puras de IO/UI.

QA reproducible usará `npm run test:coverage`, `npm run typecheck`, `npm run lint`,
`npm run build`, Playwright existente con PostgreSQL real y configuraciones de
Stryker dirigidas al código nuevo. Android: tareas Gradle existentes de unitarias,
reporte de cobertura, lint y assemble; ampliar el arnés de mutación aislado del
proyecto. Gherkin debe mapear ML01..24 a pruebas, no ser evidencia de ejecución.

Medir p50/p95 de comandos/consulta y commit→UI (objetivo de desarrollo <2 s con
conexión sana); separar latencia de Navigation SDK. Medir errores por código,
409/reintentos, duplicados evitados, llamadas de navegación por destino y cero
llamadas Google por GPS/refresco. Sin datos de clientes/tokens/coordenadas en logs
generales; detalles sensibles sólo en histórico autorizado.

Prueba física del usuario, sin ADB: inicio real, permiso aproximado/preciso,
ubicación dentro/fuera del radio, pin antiguo incorrecto, corrección permanente,
llegada/ficha y dos filtros del panel en vivo; cierre/reapertura/red retirada.
No circular ni operar el editor conduciendo. Conservar registro de build y
resultado; no certificar GPS, SDK ni estética sólo porque compila.

## 7. Integridad, recuperación y pendientes

Correspondencia documental: BL-105→T01,T02,T05,T06; BL-106→T01,T03,T05;
BL-107→T01,T04,T06; BL-108→T03,T07; escenarios y puertas→T08.
Mismos IDs en MASTER y PROGRESS. Implementación local y evidencia de ejecución
en `QA-MAPA-LLEGADA-REPUNTE.md`; no equivale a navegación física certificada.
NotebookLM no disponible: auditoría local con código y fuentes
oficiales en `references/MAPA-LLEGADA-REPUNTE.md`.

Conflictos detectados y resueltos en diseño: snapshot iniciado no se edita;
chofer no se suplanta como usuario admin; repunte no hereda estado al republicar;
SSE de publicación solo no basta; pronóstico no es incidencia real; global
location update no mueve otras publicaciones; permisos FINE requieren COARSE;
Navigation por lote puede cobrar de nuevo todos los destinos reenviados.

Puerta de construcción aprobada el 24/09: proximidad/offline/ventanas y alcance.
GREEN LIGHT para construir; INTEGRITY TOTAL y MATCH PERFECT ML-T00..08.
Puerta de validación externa pendiente:
clave Android, proyecto/billing/avisos y prueba en dispositivo; no se presume
autorización para modificar cuentas o ampliar facturación.

Rollback técnico: migración compatible hacia delante, mantener APIs previas y
datos/eventos; desactivar nuevas acciones ante fallo sin borrar evidencia. No
revertir automáticamente una ubicación que ya consumieron otros borradores;
corrección administrativa versionada conserva historial. Backend antes de APK,
revisión del diff y todas las puertas antes de commit/push autorizado a develop;
main/producción quedan fuera. El usuario autorizó commit y push de este bloque a
develop para probar la APK, aceptando la validación física de GPS/navegación
pendiente. Deploy manual a cargo del usuario después de recibir la entrega.

### Cierre local ML-T06: avisos y licencia instalada

El usuario pidió continuar el 24/09. Se verificó sin imprimir valores que Gradle,
entorno y propiedades locales no tienen clave Android. El AAR Navigation 7.9.0
contiene `LICENSE` completo, no los antiguos archivos `NOTICE.txt/LICENSES.txt`.
Construcción: extraer automáticamente del mismo artefacto los archivos legales
originales presentes, sin editar/truncar ni guardar rutas de caché en código.
Un menú «Avisos y licencias» abre lectura local virtualizada, sin WebView, red
ni secretos; si faltan las licencias el build falla. Persistir aceptación local
versionada del aviso de seguridad sólo por toque explícito, nunca en nombre del
chofer; no sustituye los términos originales que exige `getNavigator(Activity)`.
Rechazar o cerrar el aviso permite otras funciones, pero no iniciar navegación.

Escenarios ML23: aviso inicial, rechazar/volver, aceptar/persistir/rotar, fallo de
almacenamiento, lectura completa de licencia y archivo ausente, respuesta SDK
sin consentimiento. Validación JVM/política, mutación y comparación byte a byte
AAR→APK; el aspecto visual y diálogo real Google siguen en QA físico.
GREEN LIGHT local, INTEGRITY TOTAL con ML-T06/T08; no amplía configuración externa.

### Configuración autorizada ML-T06 / ML24

El usuario autorizó «sí dale» para configurar una clave Android sólo en develop,
sin activar facturación nueva. Lectura real de Google con su sesión existente:
el proyecto de Maps `ana-rutas-develop` tiene billing activo; el de FCM es distinto
y no se modifica. Navigation SDK y Maps SDK for Android estaban deshabilitados.
Habilitar sólo esos servicios y crear una clave independiente, desde el primer
momento limitada a ambos servicios y al paquete/firma debug inspeccionados.
No ampliar permisos ni modificar claves previas, FCM, backend o producción.

La clave local se genera desde la API oficial en `driver-app/navigation.local.properties`,
ignorado antes de escribir y protegido por ACL del usuario. También guarda el
origen HTTPS al que pertenece: si una compilación cambia de servidor debe pasar
su propia clave explícita o fallar cerrada. Las propiedades explícitas de Gradle
tienen prioridad, incluida una clave vacía para una compilación sin navegación.
Sin propiedad ni archivo se mantiene la pantalla de configuración pendiente.
Ninguna clave se imprime, se commitea ni se comparte en un informe.

ML24 cubre billing existente/ausente, identidad y proyecto correctos, servicios
rechazados, creación incierta recuperada por ID, restricciones completas, archivo
ignorado/ACL, prioridad/ausencia/entrada inválida/origen diferente y compilación
con firma correcta. Leer otra vez las restricciones y comparar claves antiguas
antes/después; Gradle real valida la inyección. No ejecutar destinos facturables,
instalar mediante ADB ni declarar conducción probada. Si falla la escritura local,
conservar el ID para recuperar esa misma clave, sin crear otras ni revocar ajenas.
GREEN LIGHT, INTEGRITY TOTAL y MATCH PERFECT con ML-T06/T08. La autorización de
configuración no incluye Deploy ni certificación física. Posteriormente el
usuario autorizó commit/push sólo a develop para su prueba de APK, con excepción
explícita de GPS/navegación físicos pendientes; Deploy permanece manual.
