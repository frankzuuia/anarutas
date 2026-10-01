# Bloque 1 — especificación y auditoría previa

## BL-143..146 — archivo e incidencias de producto

Autopsia: `deletePlan` elimina envíos/asignaciones; no reutilizable para archivo.
`listPlans` no distingue históricos. Las partidas del snapshot carecen de ID
propio pero su índice queda fijo por publicación; usar identidad compuesta,
no nombre de producto (puede repetirse). Atención actual sólo cierra pedidos
enteros. Los casos actuales se resuelven al entregar y no deben absorber las
reposiciones, que requieren seguimiento independiente.

| ID | Actor/acción | Resultado y recuperación | Validación |
| --- | --- | --- | --- |
| PI01 | Sistema cruza domingo/reinicia | Archiva planes pasados una vez; próximos intactos; auditoría | PG, zona, concurrencia |
| PI02 | Chofer sigue ruta archivada | Mismos permisos, pedidos, eventos y métricas | PG/regresión |
| PI03 | Chofer llegado toca partida | Formulario en estilo actual, motivo y cantidad/unidad real | JVM/E2E físico |
| PI04 | Faltante fuera de orden | Nombre/unidad/cantidad requeridos; sin inventar ID Odoo | Unit/PG |
| PI05 | Cantidad inválida/acumulado excesivo | Rechazo atómico; nada parcial | Unit/PG/mutación |
| PI06 | Red incierta/reintento/concurrencia | Recibo por comando; una incidencia; revisión vieja rechazada | PG/HTTP |
| PI07 | Sesión ajena/revocada o sin llegada | Rechazo, no fuga de partidas | PG/HTTP |
| PI08 | Entrega posterior al reporte | Confirma atención con incidencias, no entrega íntegra ficticia; reposición sigue pendiente | PG/JVM |
| PI09 | Admin consulta historial/exporta | Filtros coherentes, columnas/cantidades seguras, sin límite silencioso de página | PG/XLSX |
| PI10 | Admin consulta vivo/resuelve | Reposiciones pendientes aun de planes archivados; CAS/auditoría, sin Odoo | PG/UI |
| PI11 | Reinicio/rotación APK | Reutiliza cola durable existente; no perder comando enviado | Revisión/JVM/QA físico |
| PI12 | Foto en reposición/devolución | Obligatoria APK/API/BD; archivo privado saneado, hash en recibo, no duplicado por replay | PG/HTTP/JVM |
| PI13 | Admin ve foto / usuario sin sesión | Miniatura y apertura del WebP; 401/404 sin acceso público; ninguna URL en Excel | HTTP/UI/XLSX |
| PI14 | Pérdida de respuesta de commit | No borrar foto si BD no confirma ausencia; worker depura sólo huérfanos antiguos | Revisión/PG, fallo de red física pendiente |

Flujo: APK → endpoint móvil autenticado → lockServiceContext → incidencia propia
con snapshot/recibo → notificación panel → historial/vivo/Excel. Schema aditivo
v27; ningún DROP de datos. Archivo no filtra ejecución ni métricas. Fotos de
cliente cerrado permanecen como están. Foto obligatoria en reposiciones/devoluciones,
opcional en faltantes; volumen privado, sin EXIF, archivo preservado con historial.
Chofer selecciona Operaciones/Compras; admin corrige Departamento/Concepto con CAS.
Exportación de nueve columnas conforme a última confirmación: Fecha, Cliente,
Producto, Cantidad, Unidad, Departamento, Detalle de la incidencia, Comentarios, Orden.
Concepto, foto y chofer sólo se consultan en panel. Conceptos no confirmados quedan vacíos.
Odoo sigue de sólo lectura. Referencias: contratos locales de publicación,
driver-service-context/receipts, ExcelJS existente y Next16 local route-handlers,
use-client e instrumentation. API export privada con defensa de fórmulas.

Auditoría: GREEN LIGHT para archivo no destructivo y registro operacional.
INTEGRITY TOTAL: no sustituye liquidación BL-118 ni casos cliente cerrado.
Correspondencia PI-T01..06. Corte confirmado: domingo 20:00, zona de instalación;
worker cada minuto y recuperación al arrancar (no garantiza puntualidad si el proceso
está apagado). Conserva lunes/futuro, métricas, publicaciones y acceso de rutas iniciadas.
Pendientes de salida: prueba física de APK/cámara/reintento, preflight del volumen y
BD destino. Libro fuente no adjunto: no afirmar igualdad visual exacta con él.

## Ventanas diarias de clientes — BL-142 / VH01..VH08

Autopsia: los botones de días no eran sólo presentación. `CustomerWindow.days`
viajaba por PATCH hasta `route_customer_windows.days_mask`; `readOrderBoard`
filtraba por el día del plan, y Excel exportaba la columna «Días». Quitar sólo
los botones habría dejado horarios invisibles en ciertos días y un contrato
incoherente. Se reemplaza esa semántica de extremo a extremo por intervalos
diarios, sin cambiar ventanas explícitas de pedidos de Odoo.

| ID | Actor, precondición y acción | Resultado, datos/auditoría y recuperación | Validación |
| --- | --- | --- | --- |
| VH01 | Admin abre un cliente existente | Sólo Desde/Hasta; lista y Excel sin días | E2E/XLSX |
| VH02 | Admin guarda una o varias ventanas válidas | Intervalos diarios; versión/auditoría existentes | PG/contrato |
| VH03 | Admin envía hora inválida, fin anterior, solape o campo `days` antiguo | 422 sin escritura parcial; interfaz informa error | Unitarias/HTTP |
| VH04 | Plan de cualquier día consulta un cliente | Mismos intervalos efectivos en pedidos/ruteo | PG domingo/jueves |
| VH05 | Migración de ventanas de días distintos con horarios duplicados, contiguos o traslapados | Unión ordenada por cliente, no se pierde disponibilidad; original en archivo | PG migración |
| VH06 | Dos procesos migran a la vez o se repite migración | Una versión 26 consistente, sin duplicar archivo | PG concurrencia |
| VH07 | Admin no autorizado o versión obsoleta edita | Rechazo por sesión/versión; sin modificar cliente | Regresión API |
| VH08 | Versión previa con columna de días ausente | Si el esquema diario ya tiene su restricción, reanuda sin duplicar; de lo contrario revierte y falla cerrado | PG/regresión |

Flujo: formulario → API autenticada/versionada → validación de intervalos →
`route_customer_windows` sin `days_mask` → directorio/Excel y
`readOrderBoard` → planificación. La migración v26 usa el candado transaccional
del instalador; guarda el estado semanal original en
`route_customer_windows_legacy` antes de sustituirlo. No añade secretos,
servicios externos ni procesos manuales. La reversión a un binario que sólo
conoce v25 no es compatible sin restauración controlada de datos y esquema;
no promover hasta revisar una copia de la base de destino.

Tareas VH-T01 contrato/validación y persistencia; VH-T02 migración/auditoría;
VH-T03 consumidores (pedidos, Excel, UI); VH-T04 pruebas/QA. Referencias reales:
esquema local `customers-schema.ts`, guía local Next 16 `use-client.md` y
contrato PostgreSQL ejecutado en pruebas. Auditoría: GREEN LIGHT para el
cambio de desarrollo; INTEGRITY TOTAL con BL-020/023 al sustituir días por
intervalos diarios; MATCH PERFECT con VH-T01..04. Producción condicionada a
puertas de calidad y revisión de la base real previa al despliegue.

## Tiempo al destino — BL-141 / ETA01..08

Autopsia: setEtaCardEnabled(false), Chrome sin ETA y tracking sin duración.
NavigationRegistry retiene Navigator entre pantallas; Activity cambia destinos
con generaciones. ETA debe vivir con ese Navigator, no con la Activity destruida.
Se lee getCurrentTimeAndDistance sin nuevas solicitudes de ruta. Recalculo
invalidado antes de setDestination; SDK rerouting/routeChanged refrescan estado.

| ID | Precondición/acción | Resultado/recuperación | Validación |
| --- | --- | --- | --- |
| ETA01 | Chofer inicia guía válida | Tiempo SDK en barra, mismo dato por telemetría | JVM/compilación; QA físico SDK |
| ETA02 | Cambia destino o recalcula | Calculando, jamás tiempo previo con nuevo destino | Política/contrato/versiones |
| ETA03 | Llegué, fin/edición/guía detenida | En atención o sin destino; no marcar entrega por ETA cero | JVM/PG/UI |
| ETA04 | Rotación, mapa cerrado, reconexión | Registry sin referencias a Activity; servicio lee mismo Navigator; sin cola histórica | JVM/revisión lifecycle |
| ETA05 | GPS/ETA vencido, revocación o fallo SDK | Desactualizado/no disponible; sin cuenta regresiva inventada | Unitarios/PG |
| ETA06 | APK anterior, sesión nueva/paquete atrasado | ETA opcional/null; begin/stop limpia; secuencia antigua no pisa | PG/HTTP |
| ETA07 | Todos, varios choferes/rutas | Desplegable estable por ejecución; nombre sólo en lista; selección local | E2E responsive/teclado |
| ETA08 | Un chofer y cuatro pantallas | ETA compacto, no reduce mapa; controles/fullscreen intactos | E2E geometría |

ETA-T01: contrato/persistencia, migración aditiva v25 bajo lock existente y
proyección (ETA02,03,05,06). ETA-T02: Registry/servicio/Chrome (ETA01..06).
ETA-T03: presentación individual/global (ETA03,05,07,08). ETA-T04: QA/artefacto.
Flujo: SDK → Registry → payload tracking autenticado/versionado → PG → lectura
privada → UI. Cada sample reemplaza su ETA, nunca rejuvenece una ETA omitida.
Validar estado/segundos/edad y coincidencia de destino antes de persistir; ownership
por ejecución existente. Sin claves/IDs de negocio nuevos ni rutas pagadas extras.
Referencia: Navigator.getCurrentTimeAndDistance y TimeAndDistance.getSeconds:
https://developers.google.com/maps/documentation/navigation/android-sdk/reference/com/google/android/libraries/navigation/Navigator
https://developers.google.com/maps/documentation/navigation/android-sdk/reference/com/google/android/libraries/navigation/TimeAndDistance
Next16 use-client local consultado. Riesgo restante: QA SDK real en teléfono, no
simulado. Rollback requiere app compatible con schema25 (no bajar servidor antiguo
que rechaza ese número); columna aditiva no elimina datos. Auditoría local:
arquitectura revisada; cierre de calidad condicionado a evidencia local y QA físico.
Bloque confirmado por «si dale».

## Vista individual compacta — BL-140 / CC20

Autopsia: dashboard acumula page-heading y control-screen-header, mientras
control-screen-body limita a 60vh/750px y standalone-live exige 68vh. El pie
global añade otra fila. Solución: encabezado único configurable de la tarjeta,
ayuda desplegable y acciones existentes; layout flex del viewport. Eliminar
pie global solicitado, sin tocar avisos operativos de cada sección.

| Escenario | Actor/precondición/acción | Resultado y fallo/recuperación | Validación |
| --- | --- | --- | --- |
| CC20a | Admin autenticado abre Ruta en vivo | Un título; mapa desde arriba, sin pie ni scroll interno; ayuda oculta inicialmente | Geometría desktop/teclado |
| CC20b | Cambia chofer, actualiza o expande/reduce | Mismo feed/filtro; mapa aprovecha altura; foco recuperado | HTTP PG real + E2E |
| CC20c | Móvil, ventana baja o menú cerrado | Controles accesibles, sin overflow horizontal; mapa flexible | Responsive E2E |
| CC20d | Sin clave Maps o error externo | Fallback y avance existentes; ninguna ubicación ficticia | E2E sin Maps configurado |
| CC20e | Centro con cuatro pantallas y otras secciones | Sin regresión de tarjeta, selección, edición ni permisos | Regresión E2E |

CC-T15 implementa CC20a..e. Datos/APIs/permisos/eventos/auditoría sin cambios;
sin nuevas dependencias, cargos o secretos. Referencias locales Next16: guía
CSS (orden de estilos y validación de build), use-client (composición React).
Rollback: revertir este bloque de presentación. Auditoría local: GREEN LIGHT,
INTEGRITY TOTAL y MATCH PERFECT; no cambia reglas de ruta o liquidación.

## Destino único y continuación confirmada — BL-139 / NC01..06

Autopsia Android: renderMap dibuja preview antes de conectar Navigator. Al
recuperar una guía activa onNavigatorReady restaura guidance pero no redibuja;
también faltaba excluir el periodo setDestination pendiente. Se hace explícita
la política de preview: sin guía local/SDK, sin cálculo y sin repuntes. Redibujar
al recibir Navigator y al comenzar cálculo. Los pines pendientes son independientes.

| ID | Acción/precondición | Resultado/efectos | Fallo/recuperación/prueba |
| --- | --- | --- | --- |
| NC01 | Ir a 2 o reabrir app con guía activa | Sólo camino SDK al destino; puntos restantes intactos | Política JVM/mutación; QA físico de restauración |
| NC02 | Entrega confirmada y todos los pedidos terminales en parada | Aviso siguiente/Cerrar; nunca liquidación automática | Unitarios y Compose; parcial no adelanta |
| NC03 | Cliente cerrado confirmado con recibo | Aviso tras releer estado, punto naranja sigue pendiente | Reutiliza contrato recibo/idempotencia; error no anuncia éxito |
| NC04 | Aceptar siguiente | Siguiente elegible por posición, saltando terminales/sin punto; al final vuelve a anterior pendiente, nunca misma parada | Destino se revalida al pulsar; usa salida de visita + guía existentes |
| NC05 | Cerrar/atrás/rotar/refrescar | Cerrar no navega ni cambia atención; no reabrir aviso consumido; rotación conserva evento ViewModel | Política + instrumentación compilada, físico pendiente |
| NC06 | No siguiente/red perdida/ruta retirada | Sin navegación inventada; mensaje y Cerrar; sólo se habilita con ruta verificada | Unitarios/regresión contratos, autorización sin cambios |

NC-T01 política/aviso cubre NC02..06; NC-T02 mapa cubre NC01; NC-T03 QA/release
cubre todos. Sin nuevos endpoints, permisos, ubicación sintética o rutas Google
en background. Entregas parciales permanecen en atención. Rechazo/reprogramación
no abren el aviso. Siguiente no marca llegada: conserva radio/precisión reales.
Referencias: Navigator.isGuidanceRunning, setDestination y clearDestinations:
https://developers.google.com/maps/documentation/navigation/android-sdk/reference/com/google/android/libraries/navigation/Navigator
https://developers.google.com/maps/documentation/navigation/android-sdk/route
Integridad revisada con atención, reintentos, visitas y telemetría. Implementación
autorizada por solicitud y «continua»; QA físico no sustituido por JVM.

## Créditos y resumen sin colisión — BL-138 / CC19

Autopsia confirmada por captura real: BOTTOM_LEFT coloca el control junto al
logo, pero no reserva el ancho de los créditos. En 2×2 éstos lo superponen.
Se retira el portal/control y se reserva una fila compacta en flujo debajo del
canvas, dentro de la tarjeta. No se oculta, modifica ni consulta DOM de Google.
Misma fila con Maps disponible o fallido; números, GPS y filtros sin cambios.

| ID | Acción/precondición | Resultado | Verificación |
| --- | --- | --- | --- |
| CC19a | Cuatro tarjetas, créditos largos | Canvas y resumen no se intersectan; fila <=22 px; canvas >=190 px en escritorio | Geometría E2E 1500×800 y 1366×768 |
| CC19b | Filtro, fullscreen, móvil, fallo Maps | Una fila actualizada, sin overflow ni duplicado; controles y avance conservados | E2E con servidor/PG reales |

CC-T14 implementa y verifica CC19a..b. Sin cambio de dominio, API, permisos,
dependencias o captura GPS. La regresión estructural no depende del SDK.
Google real se revisa tras Deploy manual; no simular el proveedor.

## Resumen al pie — BL-137 / CC18 (26/09/2026)

El resumen absoluto está 27 px sobre el borde y ocupa innecesariamente una
franja del mapa. Google documenta BOTTOM_LEFT a la derecha de su logo. Usar
map.controls con portal React: Google posiciona el contenedor, React actualiza
los datos. Al desmontar retirar sólo ese contenedor, sin borrar otros controles.
Resumen compacto de una fila cuando quepa; ajuste de texto en ancho estrecho.
Fallback sin Maps anclado abajo; Avance de rutas conserva resumen en flujo.

| ID | Actor/precondición/acción | Resultado/datos/efectos | Validación y recuperación |
| --- | --- | --- | --- |
| CC18a | Admin abre mapa cargado | Resumen junto a logo por BOTTOM_LEFT, sin offsets sobre atribuciones | API/typings oficial, QA Maps real tras Deploy |
| CC18b | Admin filtra, amplía o llega nueva muestra | Mismo control actualiza cifras/GPS, sin remontar mapa ni duplicados | E2E/regresión y revisión de effect/portal |
| CC18c | Maps falla o ancho se reduce | Resumen abajo, legible y sin desbordamiento; reintento/avance accesibles | E2E fallback real en 2×2, fullscreen y móvil |

Sin API, esquema, autorización, coste Routes ni lógica de progreso nuevos.
Rollback UI únicamente. Referencias: Next16 CSS local; Google Maps Controls y
ControlPosition.BOTTOM_LEFT (tipos instalados indican explícitamente a la
derecha del logo). GREEN LIGHT / INTEGRITY TOTAL; CC-T13 cubre CC18 (MATCH PERFECT).

## Mapa prioritario — BL-136 / CC17 (26/09/2026)

Autopsia: el contenedor estrecho exige mapa de 320 px y lista debajo dentro de
una tarjeta que sólo deja ~130 px; genera scroll y recorte. `button.quiet`
posterior gana por igual especificidad y elimina el fondo de controles.
La clave de encuadre no cambia al aparecer el primer GPS: puede quedar fuera.
El usuario confirmó que tenía una APK anterior y que al instalar 0.7.0 apareció
el GPS. No se modifica servicio/autorización. Pide además camioneta en lugar de
flecha: se reutiliza el SVG Truck del panel en un marcador circular compacto,
sin nombre visible (sólo identificación accesible), ubicación real y gris cuando
la señal envejece. Corrección expresa del usuario: el filtro identifica al chofer.

| ID | Actor/precondición/acción | Datos/resultado/efecto | Validación y recuperación |
| --- | --- | --- | --- |
| CC17a | Admin abre cuatro tarjetas de escritorio | Mapa >=70% del alto de tarjeta, sin scroll que lo recorte; controles opacos; lista desplegable | E2E 1500×800/1366×768, geometría y captura |
| CC17b | Preferencias antiguas con camioneta, cambia chofer | Sólo chofer afecta rutas; filtros independientes y persistencia intacta | E2E HTTP + unit/mutación |
| CC17c | Abre/cierra avance con teclado, expande o consulta parada | Detalles accesibles, Escape cierra/restaura foco; mapa no se remonta | E2E de dimensiones, foco y fullscreen |
| CC17d | Primera muestra GPS aparece después del mapa | Se encuadra una vez; siguientes muestras no resetean cámara; falta GPS nunca genera pin | Política unit/mutación, API PG real; Maps físico pendiente |
| CC17e | Maps/red no disponible, ventana móvil o vista de avance | Reintento y lista disponibles; sin overflow horizontal; no perder datos | E2E fallback real sin clave, contratos GPS existentes |

Flujo/API/permisos: mismos GET privados y PUT de distribución CAS. No nuevas
tablas, polling ni solicitudes Routes. GPS procede exclusivamente de tracking.
Compatibilidad: se conserva vehicleId en contrato almacenado, se ignora en vista
y se limpia al seleccionar chofer. Rollback sólo UI, sin pérdida de auditoría.
Referencia: Next16 docs locales use-client/CSS (cascada en build), Google Maps
https://developers.google.com/maps/documentation/javascript/reference/map
y https://developers.google.com/maps/documentation/javascript/controls.
Riesgos abiertos: validación de Maps real del nuevo aspecto después de Deploy;
no certificar sensado por una prueba de servidor ni simular Maps.
Auditoría local GREEN LIGHT; INTEGRITY TOTAL con CC01..16; CC-T11/12 cubren
CC17a..e (MATCH PERFECT). Se precisa CC15: listas desplazan; mapa no se recorta.

## Endurecimiento de eventos del panel — BL-135 / RT09 (26/09/2026)

El reporte de mutación del bloque CC16 reveló rutas no observadas, no un fallo
confirmado de datos: latido tras `change`, canal ajeno sobre una sesión PG con
`LISTEN` heredado, `LISTEN` en transacción fallida y clasificación de error.
PostgreSQL registra canales por sesión y entrega sólo tras commit; las pruebas
usan conexiones reales del PG aislado. La autenticación actual sólo produce
`AppError(401)`; se conserva la distinción para una futura variante no 401
mediante una función pura comprobable. No cambian endpoints ni payload SSE.

| ID | Actor/precondición/acción | Datos/resultado/efecto | Validación y recuperación |
| --- | --- | --- | --- |
| RT09a | Admin recibe `change` y espera | Próximo intervalo emite `heartbeat`, no repite `change` | PG real/SSE y mutación |
| RT09b | Sesión PG heredó otro `LISTEN` o falla el nuevo `LISTEN` | Ignora canal ajeno; destruye conexión fallida y permite reconectar | PG real con pool de una conexión |
| RT09c | Sesión 401, otro `AppError`, error ajeno o abort durante autenticación | Sólo 401 emite `session-expired`; fallos ajenos cierran para reconexión; sin timer huérfano | contrato puro, PG bloqueado, mutación |

Auditoría: GREEN LIGHT para pruebas y cierre SSE acotado; INTEGRITY TOTAL con
RT01..08 y CC16. RT-T07 mapea RT09a..c (MATCH PERFECT). Sin mocks ni migración.
Referencia: PostgreSQL `LISTEN`/`NOTIFY` oficial y código local de `pg`.

## Barra única del Centro de control — BL-134 / CC16 (26/09/2026)

El encabezado genérico y la fila de comandos generan dos niveles verticales.
Sólo el Centro de control integra su título y ayuda con el estado de guardado,
«Agregar pantalla» y «Actualizar» en una barra compacta. El padre mantiene la
función de refresco y su condición de bloqueo; el centro mantiene estado,
persistencia, selector y referencia de foco. No cambia ninguna API, consulta,
tabla, permiso o auditoría. La barra se adapta al ancho disponible; en escritorio
prioriza el alto de las tarjetas sin recortar la cuadrícula de cuatro.

| ID | Actor/precondición/acción | Datos/resultado/efecto | Validación y recuperación |
| --- | --- | --- | --- |
| CC16a | Admin abre Centro de control en escritorio | Los cinco elementos comparten la barra; las tarjetas comienzan más arriba | E2E de geometría a 1500×800 y captura |
| CC16b | Admin actualiza, agrega y guarda pantallas | Consultas reales se repiten; selector, foco y estado CAS se conservan | E2E HTTP, guardado y recarga |
| CC16c | Admin cambia a ventana estrecha o usa ayuda con teclado | Barra ajustada sin desbordamiento; ayuda superpuesta no desplaza tarjetas | E2E responsive y teclado |

Auditoría local: GREEN LIGHT; INTEGRITY TOTAL con CC01..15; CC-T10 corresponde
a CC16a..c (MATCH PERFECT). El único riesgo de regresión es la conexión del
refresco entre padre y tablero; la prueba HTTP lo verifica. No hay migraciones.

## Ajuste visual BL-131 / CC13 (26/09/2026)

El pie lateral informativo se retira de Dashboard; no contiene acciones ni
controles de seguridad. La ayuda redundante del Centro de control se mueve a un
`details/summary` junto al título. Cerrada no consume altura; abierta se
superpone sin redimensionar el tablero. Sólo cambia la presentación, no la
configuración persistida, permisos, telemetría o refresco.

| ID | Actor/precondición/acción | Datos/resultado/efecto | Validación y recuperación |
| --- | --- | --- | --- |
| CC13a | Admin abre Centro de control | Menú completo sin pie informativo; tarjetas más altas | E2E y captura de escritorio; navegación intacta |
| CC13b | Admin usa teclado o puntero sobre ayuda | Abre/cierra explicación junto al título sin desplazar tarjetas | E2E teclado, visibilidad y cierre |
| CC13c | Admin agrega, filtra, amplía o quita pantallas | Contratos y estado previos intactos | E2E existente de flujo completo |

### Incidencias en vivo BL-132 / CC14

El panel vivo no pide fecha: su consulta sin rango toma los casos de ejecuciones
iniciadas con publicación vigente, incluso si el evento ocurrió otro día. El
filtro por chofer y el cursor quedan ligados al alcance; se conserva el rango
opcional en la API para clientes previos, pero no aparece en la interfaz viva.
La pantalla histórica «Incidencias» mantiene fechas y su endpoint original.
Las métricas siguen el mismo alcance que la lista. Cancelar una publicación
quita esos casos de la vista viva y preserva el evento/auditoría en PG. El
cierre por liquidación aún no existe: cuando se implemente deberá retirar la
ejecución del alcance vivo sin borrar sus registros.

En Centro de control, filtros de chofer y tres métricas se compactan; la ficha
resume tipo, negocio, pedido y estado. Dirección, motivo, nota, foto y acción
administrativa se abren mediante «Detalles y acciones». La vista independiente
conserva la ficha amplia. No se duplican consultas ni cambia el contrato de
resolución.

| ID | Actor/precondición/acción | Datos/resultado/efecto | Validación y recuperación |
| --- | --- | --- | --- |
| CC14a | Admin ve casos de ruta vigente de día anterior | Caso y métricas visibles sin fecha manual | PG sin rango, E2E HTTP |
| CC14b | Admin filtra chofer, página o usa API antigua con fechas | Aislamiento y cursor válido; histórico conserva fechas | PG/contrato/E2E |
| CC14c | Publicación deja de estar vigente | Caso sale del vivo, fila/auditoría permanecen | PG real de cancelación |
| CC14d | Admin abre ficha compacta | Foto, nota y Resolver disponibles; dos casos visibles sin desplazar primero | E2E pantalla dividida, teclado y vista amplia |

### Cuatro pantallas en el mismo viewport — BL-133 / CC15

Para cuatro instancias en escritorio, el contenedor distribuye la altura
disponible después del encabezado, comandos y pie en dos filas iguales. Las
cuatro tarjetas completas permanecen visibles; su contenido extenso tiene
scroll interno. Más de cuatro pantallas usan el mismo alto de fila con scroll
del tablero, sin reducir indefinidamente las tarjetas. En anchos de 1000 px o
menos, o alturas menores de 680 px, se conserva el flujo desplazable anterior.
No cambia la distribución guardada, las consultas ni los permisos.

| ID | Actor/precondición/acción | Datos/resultado/efecto | Validación y recuperación |
| --- | --- | --- | --- |
| CC15a | Admin agrega cuatro pantallas a 1500×800 o 1366×768 | Cuatro marcos 2×2 completos, sin scroll de página | E2E de geometría y captura |
| CC15b | Una pantalla contiene más información que su marco | Scroll sólo dentro de esa tarjeta; otras quedan a la vista | E2E scroll y acciones posteriores |
| CC15c | Admin amplía, mueve, quita o reduce pantallas | Estado y orden preservados; una pantalla llena la altura disponible | E2E de flujo existente |
| CC15d | Admin agrega una quinta pantalla | Scroll dentro del tablero sin comprimir las otras tarjetas | E2E de cinco instancias |

Auditoría local: GREEN LIGHT; INTEGRITY TOTAL con CC01..12 y AI01..17.
CC-T07 y CC-T08 corresponden a CC13/CC14 (MATCH PERFECT). No hay migraciones.

## Centro de control — CC01..CC12 / BL-126..130

### Autopsia y contratos

GPS local en RouteNavigationActivity se cancela en onStop; DriverApi sólo envía
GPS en comandos. NavigationRegistry mantiene el destino local. Se necesita
transporte nuevo, sin modificar revisión operativa ni canal global panel_changed.
v24 agrega última telemetría por ejecución y preferencias de pantallas por admin.
POST mobile/plans/:id/tracking: begin (UUID idempotente de sesión), sample
(secuencia creciente, edad monotónica, punto opcional, destino), stop. Revalida
dispositivo/publicación en transacción; otra sesión vigente invalida la anterior.
Sólo la primera apertura de sesión escribe auditoría. GET live-routes devuelve
snapshot consistente, paradas/pedidos canónicos y GPS con hora del servidor.
GET/PUT control-center guarda JSON validado con versión/CAS y origen mismo sitio.
Máximo 32 pantallas por configuración como protección del navegador/Maps y body
16 KiB; visible en selector. No coordenadas, tokens ni fotos en preferencias.

Android: servicio foreground location, notificación persistente con Detener;
arranca desde mapa de ejecución verificado/visible. POST secuencial cada 5 s,
sin backlog de GPS. Muestra edad relativa (no reloj de pared del teléfono), mock
rechazado. Sesión perdida/revocada detiene servicio; fallos red reintentan sólo
muestra reciente. Permiso denegado deja mapa sin seguimiento y aviso explícito.
Panel: refresco 5 s, timeout, aborto y pausa oculto; edad avanza localmente aun
fallando red. Chofer/vehículo seleccionados por instancia. Polilínea es
recorrido publicado, no traza recorrida; se omite cuando hubo repunte. Sin nuevos
cálculos Google. Pendientes naranjas, entregadas/reprogramadas fuera del mapa,
lista íntegra y métricas con estados separados. Destino explícito o visita actual,
nunca adivinar por el primer pedido. Mapas mantienen zoom/centro entre muestras.

Ampliación confirmada por usuario: selector incluye TODAS las secciones del
panel (planes, incidencias históricas, camionetas, unidades, choferes, clientes,
usuarios, auditoría, consumo), reutilizando Dashboard en modo embebido sin nav.
Centro de control no se incluye a sí mismo (evita recursión); Ruta en vivo e
Incidencias en vivo tienen sus componentes dedicados. Panel embebido conserva
permisos/comandos/revisiones; SSE único del padre distribuye revisiones, no una
conexión nueva por pantalla. Expansión por Fullscreen API preserva instancia,
formularios, filtros y foco; los dialogs nativos siguen dentro del elemento.

### Matriz de escenarios y tareas

| ID | Actor/precondición/acción | Datos/resultado/efecto | Validación y recuperación |
| --- | --- | --- | --- |
| CC01 | Chofer autorizado inicia mapa | sesión vinculada ejecución/dispositivo; auditoría inicio | PG real; no ruta -> 404 |
| CC02 | GPS recibido, duplicado o fuera de orden | última muestra avanza una vez, revisión servicio intacta | unit/PG concurrencia; duplicado no retrocede |
| CC03 | Otro chofer/dispositivo revocado/publicación cancelada | sin lectura/escritura telemetría ajena | contratos HTTP/PG 401/404/409 |
| CC04 | SO/red/GPS pierde señal, permiso denegado | última ubicación fechada, sin falsa etiqueta En vivo | JVM/panel reloj; reconectar sin backlog |
| CC05 | Consulta ficha versus Ir/visita/entrega | destino sólo guía; visita/estados servidor prevalecen | regresión selección/entrega/reintento |
| CC06 | Admin abre Ruta en vivo | GPS real, progreso y recorrido publicado, filtros | E2E API real; Maps fallo deja lista accesible |
| CC07 | Admin agrega 1/2/3+ pantallas | grid adaptable, tipos duplicables, filtros independientes | unit/E2E persistir/recargar |
| CC08 | Expandir/quitar/reordenar | no resetear filtros, Escape restaura foco | E2E teclado/layout |
| CC09 | Dos pestañas guardan misma versión | CAS rechaza segundo; recargar explícito | PG paralelo/E2E |
| CC10 | Incidencias en otra pantalla | filtros y acciones existentes, IDs dialog únicos | regresión incidentes/privacidad |
| CC11 | Logout/detener/cambio ruta | cancela servicio antiguo y autorización revalidada | JVM/build; físico pendiente sin ADB |
| CC12 | Snapshot vacío/error/oculto | estado honesto, recuperación y peticiones acotadas | E2E/seguridad/tipos/build |

### Fuentes, seguridad, calidad y auditoría

Next16 docs locales route-handlers/server-and-client-components. Android:
https://developer.android.com/develop/sensors-and-location/location/permissions
https://developer.android.com/develop/background-work/services/fgs/service-types
https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
SDK Maps instalado: AdvancedMarkerElement y Polyline. Datos privados no-store,
SQL parametrizado, permisos existentes, FK ejecución/destino, secuencia/lease.
SLO objetivo en conexión sana: ubicación visible <=15 s; reportar observado,
no garantía bajo suspensión SO. Pruebas PG reales, unitarias/mutación dirigidas,
contratos/E2E, cobertura política crítica objetivo 100% ramas; lint/tipos/build.
GPS/background físico requiere teléfono del usuario sin ADB; no certificarlo por
compilar. Migración aditiva: una reversión de UI debe conservar soporte de v24;
el binario previo rechaza versiones desconocidas. No degradar el marcador ni
borrar historia para desplegar código antiguo.
Auditoría local: GREEN LIGHT documental; INTEGRITY TOTAL con atención/incidencias;
MATCH PERFECT CC-T01..06. Cobros/cierre/liquidación permanecen fuera de alcance.

## BL-124..125 / IF01..IF07 — tarjetas y teclado de incidencias 0.6.2

### Autopsia, alcance y flujo

`ServiceIncidentSheet` usa dos FilterChip horizontales. `DetailSurface` calcula
el máximo fuera del Dialog con LocalWindowInfo del padre; dentro usa contenido
wrap-content centrado, decorFitsSystemWindows por defecto y scroll, sin insets
IME explícitos. La altura cambia al escribir múltiples líneas o añadir foto;
el teclado y la relocalización del campo compiten con el recentrado. Es una
causa de layout demostrada por código; la reproducción física exacta aún no
está certificada. No se atribuye el salto a red/GPS ni se altera su política.

Crear un contenedor de formulario específico para incidencias/atención, no
cambiar las fichas de consulta/fotos. Dialog con decorFitsSystemWindows=false,
área disponible medida por el propio layout, safeDrawingPadding + imePadding
consumidos una vez, alineación superior y altura independiente del contenido.
Encabezado fuera del scroll; cuerpo con scroll recordado, sin scroll/foco por
cada letra. Comentario máximo cuatro líneas visibles, resto desplazable en
el editor, 2,000 caracteres existentes; Done cierra teclado sin enviar. Cámara
mantiene su flujo/custodia y note permanece rememberSaveable por parada.

Tarjetas verticales: tienda cerrada y caja rechazada con los vectores locales
existentes; borde/fondo lima y check sólo al seleccionar; Role.RadioButton,
selectableGroup, target al menos 48 dp y deshabilitado real. Ninguna acción
ocurre por selección. Los dos códigos y validaciones de envío siguen intactos.
No migración, endpoint, dependencia de servidor ni acceso a producción.

### Escenarios, permisos, auditoría, recuperación y validación

| ID | Actor/precondición/acción | Resultado y datos | Validación/fallback |
| --- | --- | --- | --- |
| IF01 | Chofer atendiendo, elige tarjeta | Exclusión mutua, icono/check/borde; borrador local, cero POST/auditoría | JVM/Compose semántica; deshabilitado no cambia selección |
| IF02 | Sin pedidos rechazables, enviando o sesión no verificada | Tarjeta apropiada no seleccionable, mismas validaciones del servidor | JVM matriz disponible/pedidos; QA de envío |
| IF03 | Escribe comentario con IME abierto | Ventana/encabezado anclados; editor visible y borrador/foco conservados | Compose geometría y recomposición; QA físico sin ADB |
| IF04 | Texto largo, pantalla angosta, rotación | Editor acotado, contenido alcanzable por scroll; note rememberSaveable | JVM límite y Compose; fuente grande/multiventana físicos pendientes |
| IF05 | Rechazo Otro o reprogramación y Done | Texto obligatorio conserva validación; Done sólo cierra teclado | JVM/Compose; cancelar no escribe |
| IF06 | Cámara cancelada/retorna, red/GPS reconsulta | Se conserva borrador hasta recibo; encabezado no recentra por feedback | Contratos previos intactos; cámara/IME físicos pendientes |
| IF07 | Consulta productos/fotos/paradas | DetailSurface anterior intacto, API/GPS/guía fuera de alcance | Diff de límites, JVM regresión, build/lint |

### Referencias, calidad y veredicto previo

Android Developers: [insets y consumo](https://developer.android.com/develop/ui/compose/system/insets-ui),
[Dialog](https://developer.android.com/develop/ui/compose/components/dialog);
AndroidX AndroidDialog documenta decorFitsSystemWindows=false para ancho propio
y animación IME. No polling, coste Google ni permiso nuevo. Pruebas unitarias
de presentación, instrumentadas de layout/semántica compiladas, cobertura y
mutación dirigidas de selección/límite; lint/assemble y QA reproducible. No
afirmar validación real del teclado por JVM. No commit/push ni Deploy nuevos
sin autorización; sólo develop. GREEN LIGHT para este bloque local, INTEGRITY
TOTAL con BL-111..123; MATCH PERFECT con IF-T00..04.

## BL-120..123 / RG01..RG10 — corrección operativa 0.6.1

### Autopsia y alcance

Paleta: `selected` tiene prioridad sobre `pending`. Mapa: filtra sólo punto
no nulo y conserva marcadores/radio de pedidos terminales. Reprogramación:
`serviceTransition` es terminal y la ficha no ofrece reapertura. GPS: el
temporizador caduca la muestra pero no solicita otra; proveedor reactivado
no hace nada. Mapa SDK y comprobación de llegada usan canales independientes.
No se afirma que esta sea toda la causa física hasta prueba en teléfono.

Incidencia con foto: PG/HTTP previos prueban guardado/listado, pero la
reproducción del usuario falla antes de reprogramar. No hay acceso de lectura
al PG desplegado (sin puerto expuesto), ni evidencia suficiente para atribuir
el caso real al filtro de reintento. Añadir comprobación de recibo con ID en
APK y refresco de respaldo visible en panel; conservar filtro de nueva visita.
No destruir/recrear casos ni fotos históricas para hacer pasar una prueba.

### Flujo, contratos, seguridad y recuperación

Migración aditiva v23 amplía enums de eventos con `order_reopened`/`reopened`,
sin modificar identidad ni eventos anteriores. POST móvil por pedido `/retry`
requiere sesión propia, ejecución/publicación vigentes, versiones de ejecución,
parada, pedido y secuencia. No exige estar físicamente allí para reabrir:
se abre el pedido, no se registra llegada. Comando cifrado/replay del mismo
dispositivo; locks dispositivo → ejecución → parada → pedido. Si la parada
conservaba visita activa, registrar salida en la misma transacción. Después
del recibo se reconsulta y se ofrece guía; nueva llegada revalida GPS.
Reprogramación activa queda gestionada al reabrir, no completada; la entrega
posterior sí completa casos correspondientes. Resolver admin no reabre.
Entregado no puede reabrirse. Fallo SDK no revierte un hecho confirmado.

Marcadores sólo con algún pedido no terminal; lista completa nunca filtrada.
Cancelar guía y limpiar destino SDK cuando éste termina, también tras refresco
remoto. Cerrado tiene prioridad naranja; seleccionado mantiene contorno claro.

GPS: `LocationManagerCompat.getCurrentLocation` con CancellationSignal,
executor principal y política pura de watchdog. Solicitud única por proveedor,
timeout/cancelación y backoff; no falsificar edad con tiempo de callback.
Se conserva `elapsedRealtimeNanos`, precisión y detección mock. Actividad
detenida/proveedor desactivado cancela; muestra nula no borra una válida.
Referencia: Android Developers LocationManagerCompat/getCurrentLocation;
contrato Next instalado `15-route-handlers.md`. No hay nueva dependencia.

Panel: SSE inmediato más reconsulta visible de respaldo sin respuestas
simuladas, sin costes Google/Odoo. Filtrar y paginar igual; limpiar efectos al
salir y no lanzar lecturas solapadas. La foto sigue privada y vence a 24 h.

### Matriz (estado leído/escrito, evento, fallback y validación)

| ID | Actor / precondición / acción | Resultado, datos, auditoría, validación y fallo |
| --- | --- | --- |
| RG01 | Chofer llegó, cerrado con foto | Recibo con ID persistido, caso/foto en panel por chofer/fecha; PG+HTTP+SSE; red incierta conserva outbox, no éxito ficticio. |
| RG02 | Admin abierto, falta señal change | Refresco de respaldo obtiene caso/foto/métricas; E2E con canal bloqueado real, sin datos fake; red caída conserva error/datos. |
| RG03 | Chofer selecciona cerrado | Naranja + ! con contorno; JVM; no cambios de guía/datos. |
| RG04 | Todos pedidos terminales o mezcla | Ocultar sólo marcadores/radio terminales; SDK sin destino terminal; lista completa y mixtos visibles; JVM/build/QA físico. |
| RG05 | Reprogramado, confirmar/cancelar Reintentar | Cancelar no escribe; aceptar sólo ese pedido abierto y visita anterior abierta; eventos de salida/reapertura; PG+HTTP, fallo no deja parcial. |
| RG06 | Pedido reabierto, GPS ausente/lejos | Marcador reaparece y guía posible; entrega rechazada sin nueva llegada válida; PG/JVM. |
| RG07 | Entregado/abierto, otro chofer, versión vieja | Reapertura rechazada sin alterar otros pedidos; PG autenticación/pertenencia/versiones. |
| RG08 | Mismo comando doble / comandos concurrentes | Un evento/recibo; replay seguro, payload distinto 409; locks y PG/concurrencia/mutación. |
| RG09 | GPS caduca, proveedor retorna o muestra nula | Solicitud actual recupera sin cambiar parada/reiniciar; no confundir nula/mock/vieja con válida; JVM/watchdog y teléfono pendiente. |
| RG10 | Activity detiene/rota, resultado tardío | Cancela solicitud; resultado anterior no modifica sesión nueva; no ampliar 100 m; JVM generación/timeout, lint/build. |

### Puertas y veredicto previo

GREEN LIGHT para construir cambios demostrados y recuperación/observabilidad;
INTEGRITY TOTAL con BL-111..119 (BL-117 ahora permite reapertura explícita,
no implícita por Resolver); MATCH PERFECT contra RG-T01..05. Unitarias,
PG/contrato/HTTP/SSE/E2E, cobertura dirigida, mutación de seguridad/transición
y política GPS; lint/tipos/build/diff/supply chain. APK 0.6.1 con misma firma.
Push sólo develop autorizado el 26/09; Deploy manual del usuario. Excepción
informada: GPS/cámara/SDK físico y reproducción real de foto permanecen QA
del usuario; no se declara la causa real solucionada sin esa evidencia.

## BL-111..117 / AI01..AI17 — atención, incidencias y teléfono operativo

### Autopsia y límites reales

`RouteNavigationActivity.Chrome` decide «Atender pedido» con `arrivedAt`, pero
siempre ofrece «Iniciar guía» en la otra mitad de la fila. `navigateToStop`
cambia sólo destino local; no hay salida de visita persistida. La tabla
`route_driver_stop_events` permite únicamente llegada/repunte y prohíbe
modificaciones; `route_driver_execution_stops.arrived_at` es su proyección.
Las incidencias administrativas existentes son únicamente repunte/retraso.
`route_customers.phone` es teléfono operativo, mientras que la publicación
guarda una copia inmutable del teléfono en `snapshot.orders`; guardar el
teléfono maestro sin superponerlo en la lectura móvil dejaría la APK obsoleta.
`route_unit_photos` tiene retención de 15 días para inspección de unidad y no
es almacenamiento de evidencia de negocio. El panel ya usa PostgreSQL NOTIFY
→ SSE → invalidación de lectura.
BL-155 agrega finalización operativa durable en `route_driver_execution_completions`, independiente del libro de cobros, que sigue sin existir. `finishedAt` de la ruta es
una **estimación de navegación**, no entrega de efectivo. El snapshot publicado
contiene productos/cantidades, no precios ni importe cobrable. `route_users`
sólo distingue usuarios activos, no un permiso de liquidador. Por ello cierre
y cuadre monetario requieren un bloque propio y no pueden simularse aquí.

### Estados y propiedad

- La parada posee **visita actual** (`open`/`arrived`), independiente de la
  secuencia histórica de eventos. Salir de una visita no atendida la devuelve
  a `open` con evento de salida; no crea incidencia ni pedido entregado. Una
  llegada posterior crea una nueva visita, sin borrar la primera.
- Cada pedido (`shipment_id`) posee estado operativo `open`, `closed_pending`,
  `rejected`, `rescheduled` o `delivered`. Una parada puede contener más de un pedido; la
  llegada por parada no implica entrega de ninguno. Rechazo y cierre son
  incidentes distintos de los pronósticos y del repunte.
- «Cliente cerrado» aplica de forma atómica a **todos** los pedidos de la
  parada, no sólo al chip seleccionado. Una falla no puede dejar uno pendiente
  y otro abierto. El reintento posterior puede resolver cada pedido de forma
  independiente, sin ocultar el estado del otro.
- «Reprogramar» abre Aceptar/Cancelar con nota opcional; no muestra selector
  de fecha ni calcula calendario. Al aceptar, cierra **ese pedido** en la
  ejecución actual con estado `rescheduled` y conserva nota, chofer y ruta de
  origen. No crea ni mueve pedidos a un plan futuro: administración decide
  por separado si lo incorpora a otra ruta y en qué fecha.
- Una incidencia conserva causa, pedidos afectados, chofer, fecha/hora,
  instantánea mínima de negocio y estado operativo. «Cliente cerrado» no
  permite resolución administrativa. «Reprogramado» y «Rechazado» sí pueden
  quedar `resolved_by_admin`; `completed` significa entrega real y no se
  confunde con resolución administrativa. Reintentar no duplica ni elimina
  el historial.
  «Completada» significa entrega real; «resuelta por administración» se
  muestra aparte para no inventar entregas. Su evidencia fotográfica puede
  caducar antes que el registro histórico.
- Los hechos históricos son append-only. Las proyecciones de visita, pedido e
  incidencia se actualizan en transacciones con bloqueo de ejecución/parada,
  revisión optimista y recibo de comando por dispositivo para reintentos.

### Contratos y flujo técnico propuesto

Migración aditiva sobre versión 20 en dos subbloques locales: v21 crea la
proyección de visita y estados por pedido; v22 crea casos, vínculos por pedido,
metadatos de evidencia y eventos auditables separados de fotos de unidad.
Captura y comandos están conectados al esquema v22; lectura administrativa
privada y limpieza física reintentable tienen pruebas con PostgreSQL y archivos
reales. La puerta física de cámara/GPS permanece separada.
Backfill de ejecuciones existentes: visita activa si ya tenía `arrived_at`,
pedidos `open`; las llegadas históricas reciben secuencia 1 sin cambiar su
hecho ni su hora. La restricción de llegada única por parada se sustituye por
unicidad por visita. El servidor sigue
siendo autoridad: autentica dispositivo y ejecución publicada vigente, verifica
pertenencia del pedido a la parada, estado/versión/orden de locks, GPS al
llegar y unicidad/idempotencia antes de escribir. Una respuesta de red incierta
se recupera con el mismo `commandId` y lectura nueva, no con un POST duplicado.

El flujo es: llegada verificada → atención o incidencia. «Cliente cerrado»
exige evidencia validada y privada antes de confirmar; sólo al confirmar se
afecta el pedido. «Pedido rechazado» exige motivo permitido y texto si es
«Otro»; puede transicionar a entregado más tarde mediante nueva visita.
«Reintentar pedido» selecciona guía, no marca entrega ni quita todavía la
incidencia: la **nueva llegada** exige GPS y entonces la retira del feed vivo.
Si el chofer abandona esa visita sin atenderla, el pendiente reaparece;
no se pierde el caso por tocar un botón. «Entregado completo» requiere visita
activa y confirmación explícita, cierra los pedidos seleccionados y resuelve
sólo las incidencias correspondientes. «Resolver» administrativo se rechaza
para cliente cerrado; en reprogramado/rechazado registra actor/hora y revoca
acceso a evidencia, sin afirmar que hubo entrega. Aceptar «Reprogramar» y
actualizar el pedido debe ser atómico; crea la tarjeta de incidencia en vivo.
No habrá selector de fecha, cálculo de día hábil ni asignación futura automática.
«Resolver» esa tarjeta no reabre ni entrega el pedido cerrado en la ruta de
origen.

La evidencia usa un subdirectorio privado en el volumen ya configurado por
`RUTAS_UNIT_PHOTO_DIR`, claves opacas y metadatos separados; no requiere otro
paso manual de configuración. Reutiliza validación real de imagen/compresión,
con límite antes de leer el cuerpo completo. Lectura admin autenticada;
la APK sólo previsualiza su captura privada local, no tiene endpoint de descarga
de evidencia histórica. No hay URL pública. Acceso expira exactamente a 24 h desde el guardado por el servidor o en resolución,
lo primero que ocurra. Un trabajador borra archivos caducados y huérfanos;
fallos de I/O se reintentan sin reexponer la imagen. Métricas y listado de
panel vivo se calculan en SQL por ruta vigente/chofer/estado; el cambio confirmado emite
la señal PostgreSQL existente y el cliente reconsulta. La lectura móvil
superpone `route_customers.phone` vigente a la copia publicada, sin mutar el
snapshot. Guardar teléfono bloquea cliente, verifica versión, marca override y
actor chofer; Odoo sigue siendo sólo lectura.

El recibo `/api/mobile/plans/:id/commands/:commandId` sólo confirma comandos
del mismo dispositivo/ejecución autorizada. Permite recuperar un envío ya
confirmado aunque Android haya perdido su archivo; no revela recibos ajenos.
La outbox vive en `noBackupFilesDir`, la cámara en caché privada y los metadatos
del comando se cifran con Keystore antes de transmitir. No se borra el recibo
histórico. El servidor revalida versión y visita activa; una foto de «cerrado»
impide entregar en esa misma visita sin registrar el reintento. Reprogramar sí
puede cerrar el pedido desde la visita que registró el negocio cerrado.
Guardar un teléfono no cambia la selección de pedido ni cierra el formulario
de incidencia. El pedido seleccionado se propaga al abrir el rechazo.

### Matriz de aceptación y fallos

| ID | Actor / precondición / disparador | Resultado, validación y recuperación |
| --- | --- | --- |
| AI01 | Chofer llega con GPS válido a parada propia | Evento y visita `arrived`; atención visible, no «Iniciar guía» de esa parada; POST repetido no duplica. |
| AI02 | Llegó a 1 sin atención; pulsa «Ir» a 2 | 1 vuelve a `open` sin incidencia; llegada histórica intacta; regreso exige GPS y nueva llegada. |
| AI02a | APK anterior registra Llegué en 2 sin enviar salida de 1 | El servidor cierra 1 en la misma transacción después de validar GPS de 2; no modifica pedidos ni deja dos visitas activas. |
| AI03 | Guía SDK falla o responde tarde al cambiar | No reanima destino anterior; estado de visita confirmado se reconsulta; no se registra entrega. |
| AI04 | Llega y abre pedido de parada con varios pedidos | Cada pedido y sus productos/estado correctos; abrir ficha no altera ruta ni visita. |
| AI05 | Reporta cliente cerrado con foto válida | Incidencia y todos los pedidos de la parada pendientes; marcador ! y reintento; panel muestra foto/chofer/fecha en vivo, sin «Resolver» administrativo. |
| AI06 | Cámara cancelada, archivo corrupto/grande, storage caído o red incierta | Sin incidencia parcial; no se publica imagen; reintento seguro con misma clave y limpieza de huérfanos. |
| AI07 | Reintenta local cerrado | Tocar guía no quita incidencia; nueva llegada válida la retira del feed. Entrega la completa; abandonar sin atender restaura pendiente; si sigue cerrado puede reprogramar. |
| AI08 | Rechaza por calidad/tarde/otro | Motivo auditable; «Otro» exige texto; estado rechazado, no pendiente de reintento ni entregado. |
| AI09 | Cliente cambia de opinión después de rechazo | Nueva visita permite entrega; historial de rechazo permanece, panel muestra resolución por entrega. |
| AI10 | Administrador pulsa Resolver en reprogramado/rechazado o intenta hacerlo en cliente cerrado | Registra actor/hora sólo en los dos primeros; foto deja de ser accesible; cliente cerrado devuelve rechazo de operación y nunca se inventa entrega. |
| AI11 | Sin teléfono; chofer añade o cancela | Cancelar no escribe; guardar válido se refleja en ficha admin y APK vigente sin republicar; llamada usa `tel:` seguro. |
| AI12 | Chofer/administrador ajeno, cliente archivado o versión concurrente | 404/409 sin filtrar datos ni sobrescribir otro número; auditoría sin secretos ni foto. |
| AI13 | Panel desconectado/reconectado; dos choferes crean incidencias | Reconsulta SSE/backup y filtros; tarjetas/métricas por chofer nunca se cruzan. |
| AI14 | Foto supera 24 h, se resuelve o falla limpieza | Acceso denegado desde vencimiento; eliminación física automática reintentable; historial sin foto se conserva. |
| AI15 | Parada con dos pedidos y cliente cerrado | Una sola confirmación con foto deja ambos pendientes; rollback de cualquier escritura conserva ambos abiertos; panel y marcador reflejan dos pedidos. |
| AI16 | Chofer pulsa Reprogramar, cancela/acepta con nota, repite o compite con entrega | Cancelar no escribe; aceptar cierra sólo ese pedido en la ruta actual como `rescheduled` y crea tarjeta en vivo, sin fecha ni duplicados; «Resolver» no reabre el pedido. Administración decide por separado si/cuándo asignarlo a otra ruta. |
| AI17 | Navegación/entregas finalizan pero no existe liquidación confirmada | Ruta permanece abierta; ningún `finishedAt` estimado sustituye efectivo recibido/cuadre. Al cerrar tras liquidar, el feed/historial visible de incidencias deja de mostrar la ruta, pero auditoría persiste. |
| AI19 | Administración abre Incidencias o Incidencias en vivo desde el panel lateral | Pantallas independientes: la primera mantiene repuntes/llegadas/reglas; la segunda contiene casos operativos, evidencia, métricas y resolución, con filtros propios y el canal SSE existente. Navegar no modifica ningún caso. |

### Puertas, auditoría y riesgos

Gherkin AI01..AI17; unidad de transición/validación, PostgreSQL real para
backfill, locks, concurrencia, idempotencia y rollback; contrato HTTP móvil/
admin, aislamiento, autorización de foto, SSE, Android JVM y E2E del panel.
Mutation testing de transiciones y permisos; cobertura medida por ramas de
riesgo y regresiones de llegada/repunte/FCM. QA físico de cámara, GPS, guía y
marcadores queda a cargo del usuario, sin ADB por su decisión. Objetivos:
cero entregas o incidencias falsas en fallos, cero acceso a evidencia ajena,
ninguna foto accesible después de resolución/24 h y ninguna duplicación ante
reintentos. Medir latencia p95 de comando/SSE, fallos de storage y limpieza.

Auditoría local actual: **GREEN LIGHT documental** para construir atención e
incidencias por bloques, **INTEGRITY TOTAL** con el snapshot publicado y Odoo
de sólo lectura, **MATCH PERFECT** entre BL-111..117, AI01..AI17/AI02a y AI-T00..07.
La asignación de pedidos reprogramados a rutas futuras es una decisión
administrativa posterior, no una automatización implícita. El cierre/
liquidación pertenece a otro bloque y no está certificado aquí. Este veredicto
no certifica implementación, GPS real ni evidencia física en teléfono.

## BL-118 — frontera del futuro bloque de liquidación

El cierre real no existe en el esquema actual. Su implementación futura
exigirá identificar la fuente autorizada de importes y forma de cobro por
pedido (hoy ausentes en `SourceShipment` y en el snapshot móvil), el modo de
registrar efectivo recibido por el chofer, el rol y doble verificación del
administrador liquidador, diferencias/devoluciones, caja, reversos y destino
de rechazados/reprogramados. No se usará `route.finishedAt`: es ETA calculada.
El estado terminal de ejecución, la liberación de chofer/vehículo, el retiro
del feed vivo y la retención histórica se definirán juntos, con migración y
pruebas de concurrencia e idempotencia. Hasta ese bloque, no habrá botón
«Cerrar ruta» ni eliminación de historial por un cierre ficticio.

## BL-119 / AI18 — visibilidad de paradas no activas

El marcador de `RouteNavigationActivity.markerIcon` pinta paradas no activas
con `#30353C` sin borde; sobre el mapa oscuro desaparecen. La corrección
extrae una política pura de estilo por estado `selected/arrived/normal` y
dibuja un contorno claro para normal y llegada, dejando el relleno lima de
selección como está. La superposición de varios pedidos conserva su etiqueta
y clic; no cambia `selectedId`, `Navigator`, GPS, datos ni comandos.

| ID | Actor / precondición / disparador | Resultado, validación y recuperación |
| --- | --- | --- |
| AI18 | Chofer ve dos o más paradas en mapa oscuro; selecciona otra | Todas las no activas tienen contorno visible; sólo la seleccionada conserva destaque lima; etiquetas/clic/guía intactos. |

Puertas: unitarias JVM de selección de paleta para normal, llegada y activo;
compilación y lint Android; revisión visual física posterior con teléfono del
usuario. GREEN LIGHT para este subbloque aislado: no requiere migración,
decisión financiera ni nuevos permisos. INTEGRITY TOTAL con BL-105 y BL-109.
MATCH PERFECT con AI-T08 de PROGRESS. No certifica aspecto real hasta prueba
en dispositivo.

## BL-109..110 — destino elegido y corrección lejana del punto anterior

Autopsia: tocar un marcador llama `openStopInfo`, que sólo abre los pedidos; no
existe una transición explícita desde esa ficha hacia `Navigator.setDestination`.
`beginEdit` centra la cámara en el punto antiguo y el botón «Mi ubicación» cambia
`draftPoint` sin centrarla ni filtrar antes GPS inválido. La app y el servidor ya
validan la muestra contra `corrected ?: stop.point` / `input.point ?? geoPoint(stop)`:
el radio no depende del punto antiguo. El cambio es Android local, sin migración,
endpoint nuevo, Odoo, FCM ni escritura del panel fuera del comando existente.

| ID | Actor / precondición / evento | Resultado / datos / validación / recuperación |
| --- | --- | --- |
| NV01 | Chofer, ejecución verificada; toca marcador | Sólo consulta pedidos; selección y guía intactas. |
| NV02 | Chofer; pulsa «Ir a esta parada» con Navigator listo | Cierra ficha, selecciona parada, cancela guía anterior y solicita destino nuevo; pedidos/orden/llegadas intactos. |
| NV03 | SDK devuelve éxito antiguo después del cambio, o falla el nuevo destino | Generación/destino bloquean respuesta vieja; fallo conserva parada seleccionada y permite reintentar. |
| NV04 | Ruta retirada, sesión sin verificar, GPS/SDK sin preparar o comando ocupado | No inicia guía; estado y razón visibles, sin mutación de servidor. |
| RP01 | Chofer junto al local correcto, pin anterior lejano; usa GPS actual válido | Pin salta al GPS y cámara lo centra; radio se evalúa contra punto nuevo, sin escrituras aún. |
| RP02 | Chofer mueve pin manualmente o mantiene pulsado el mapa | Puede escoger coordenadas sin límite respecto al pin anterior; confirmación requiere GPS reciente/preciso/no simulado en radio nuevo. |
| RP03 | GPS ausente, viejo, impreciso o simulado; error de red o conflicto de revisión | No confirma ubicación; modal/datos editados se preservan o se solicita revisión según comportamiento existente. |
| RP04 | Chofer confirma pin y domicilio, o sólo pulsa «Llegué» | Repunte usa transacción/auditoría existentes; «Llegué» conserva política y no cambia domicilio. |

Flujo NV: marcador → ficha de sólo lectura → intención explícita → selección local
→ `stopGuidance/clearDestinations` → `setDestination` → validación asíncrona por
generación y coordenadas → `startGuidance`. Flujo RP: GPS monotónico o interacción
manual → propuesta local → domicilio confirmado → `RouteExecutionModel.submit` →
servidor valida contra propuesta y registra transacción/incidencia existente.
Permisos y aislamiento no cambian; ninguna clave se agrega al APK. Si el SDK no
calcula, sólo se reintenta la guía. No se genera ruta/ETA falsa en la ficha.

Referencia oficial: [Navigation SDK, destino único](https://developers.google.com/maps/documentation/navigation/android-sdk/route)
y [Android Location](https://developer.android.com/reference/android/location/Location).
Puertas: JVM de geofence/selección y respuesta tardía; cobertura y mutación
dirigidas; build/lint/APK; prueba física del chofer en su teléfono para cámara,
GPS y cambio real de guía. Objetivo: cero llegadas o correcciones fuera de radio,
cero reactivaciones de guía vieja y cero escrituras al sólo consultar/mover.
Auditoría local: GREEN LIGHT; no API ni dato inventado; INTEGRITY TOTAL con
BL-105..107; MATCH PERFECT con NV/RP de PROGRESS. El QA físico no se certifica
desde el escritorio.

## Corrección 0.5.3 — reloj GPS y asignaciones del mapa

Autopsia: `Chrome` comparaba muestras recién recibidas con `tick`, capturado hasta
un segundo antes. Una muestra posterior al tick resultaba «futura» y STALE hasta
el siguiente pulso. No es necesario relajar la política: cada evaluación debe leer
el reloj monotónico vivo una sola vez; el pulso sólo provoca reevaluación para caducar
lecturas aunque no lleguen callbacks. Llegada y ambos pasos de repunte comparten
la evaluación. La validación final del comando/servidor permanece intacta.

El filtro `all` del mapa incluía pedidos sin camioneta. Una selección pura compartida
por puntos, lista, métricas y trazos incluirá sólo asignaciones a camionetas del plan.
«Sin asignar» es una vista explícita sin recorrido. Cálculos de otro plan/versión o
con una secuencia distinta de la asignación vigente no pueden mostrarse como vigentes.
Una selección vacía muestra «Sin pedidos asignados», sin «Recorrido vigente» ni 0 km.
No se borran pedidos ni se publican rutas, cambian permisos o añaden llamadas Google.

| ID | Actor / precondición / evento | Resultado y validación |
| --- | --- | --- |
| F01 | Chofer, GPS preciso nuevo entre dos pulsos | READY continuo en llegada/repunte; regresión JVM temporal |
| F02 | Chofer, sin nuevo GPS / muestra futura, simulada o fuera del radio | Caduca o bloquea; no se extiende vigencia ni radio; JVM + mutación |
| F03 | Administrador, quitar último pedido de camioneta | Desaparece de todas las camionetas; permanece en vista Sin asignar; unidad + E2E PG real |
| F04 | Administrador, mover a otra camioneta o quitar camioneta | Sólo aparece en asignación nueva; no trazo viejo; unidad |
| F05 | Administrador, respuestas de plan/cálculo de versiones distintas | Puntos actuales sin recorrido obsoleto; unidad |
| F06 | Administrador, filtro sin paradas / sin Google configurado | Contador cero y estado vacío correcto; E2E sin simular Google |

Flujo: Location → evaluación monotónica → controles → comando ya validado;
OrderBoard + PublicOptimization → selección → render/limpieza de marcadores.
Datos: sólo lecturas/suscripciones ya existentes; sin migraciones, notificaciones
ni auditoría adicional al abrir una vista. Errores de red mantienen las advertencias
existentes. Revertir el commit de develop revierte la presentación, no datos.
Puertas: pruebas unitarias, cobertura de ramas críticas, mutación, E2E HTTP/PG,
lint/typecheck/build y APK. Objetivo: 100% líneas del selector/evaluación nuevos y
ningún mutante crítico superviviente; GPS físico sigue a cargo del usuario, sin ADB.
Referencias: Android [SystemClock](https://developer.android.com/reference/android/os/SystemClock)
y [Location](https://developer.android.com/reference/android/location/Location#getElapsedRealtimeNanos());
Next instalado `01-app/01-getting-started/05-server-and-client-components.md`.
Auditoría local: GREEN LIGHT para implementar; INTEGRITY TOTAL; MATCH PERFECT
con tareas F01..06 de PROGRESS. No certifica aún ejecución de las pruebas.

## Ajuste 0.5.1 — visualización y domicilio confirmado

La ficha del mapa puede plegarse sin perder guía, selección ni GPS; tocar un marcador abre su parada sin redirigir Navigation SDK. La voz se silencia mediante el ajuste oficial del navegador y el estado se conserva en la APK. Una muestra GPS reciente y válida de la misma parada amortigua sólo variaciones transitorias de precisión; la API mantiene la autoridad y rechaza muestras viejas, simuladas o fuera del radio.

Revisión 0.5.2: la última lectura precisa se conserva como candidata sólo mientras cumpla
la edad máxima configurada por el servidor y exista una lectura actual posterior
imprecisa; una lectura confiable fuera de radio, simulada, vencida o de otro destino
revoca esa posibilidad. Se descartan callbacks de proveedor con tiempo monotónico
anterior. El ajuste de voz se aplica al crear el Navigator, al comenzar/reanudar la
guía y al cambiar el interruptor. Se ocultan mediante APIs oficiales la tarjeta ETA
y el botón de reporte de Google, no su atribución obligatoria.

Mover un pin no permite deducir un domicilio postal. Confirmar el pin abre un modal obligatorio con calle y número, colonia, código postal y ciudad; cerrar el modal no escribe. La confirmación final manda las cuatro partes con las coordenadas en un único comando. La misma transacción cambia `route_customers.delivery_address`, su índice de búsqueda, la parada operativa propia y el historial/incidencia; las lecturas del panel y pedido móvil muestran el nuevo texto. La sobreescritura local sobrevive a la sincronización con Odoo. Se conserva la compatibilidad de la APK anterior al omitir el campo. No se escribe en Odoo ni se recalculan otras camionetas. Validación física pendiente.

## BL-105..108 / ML01..24 — mapa, llegada, repunte e incidencias

Especificación aprobada: `BLOQUE-MAPA-LLEGADA-REPUNTE.md`. Autopsia real,
contratos nuevos diferenciados de los existentes, permisos, datos/locks, costos,
recuperación y matriz ML01..24. Fuentes: `references/MAPA-LLEGADA-REPUNTE.md`.
El usuario confirmó repunte automático del cliente y filtros fecha/chofer.
Bloque y parámetros aprobados con «dale» el 24/09: GREEN LIGHT para construcción,
INTEGRITY TOTAL y MATCH PERFECT documental ML-T00..08. Clave Android configurada
en develop; pendiente validación física antes de certificar el mapa y navegación.
El plan conserva snapshots iniciados, orden de pedidos, cancelación, fotos y FCM;
introduce estado operativo separado y no sustituye pronósticos por hechos.

Implementación local esquema20: rutas móviles execution/arrival/location,
consulta administrativa incidents y política driver-operation-settings.
Evidencia en `QA-MAPA-LLEGADA-REPUNTE.md`; no certifica SDK/Android físico.
El trigger de recálculo de clientes excluye autor chofer para no recalcular
otras rutas por repunte; comandos usan locks explícitos de sesión/plan/publicación/
ejecución/cliente. Incidencias conserva microsegundos en cursor. Reintentos Android
cifrados por plan y efectos de guía posteriores a la lectura confirmada.
La respuesta atrasada del SDK se valida contra ejecución/parada/coordenadas y
generación antes de iniciar guía; destino cambiado requiere confirmación nueva.
Aviso previo versionado con confirmación explícita; menú local de licencias
extraídas sin cambios del mismo AAR instalado. La guía se bloquea sin confirmar
el aviso y mantiene los términos nativos Google; prueba física pendiente.
Validación local cerrada: 540 servidor, 43 Android, 3 E2E; informe registra
mutación, cobertura y límites físicos. El usuario autorizó commit y push de este
bloque exclusivamente a develop para probar la APK, aceptando GPS/navegación
físicos pendientes. Deploy manual del usuario; sin autorización para main ni
producción. Esta entrega no certifica navegación real.

ML24 / autorización del usuario: configurar sólo la clave Android de develop
en el proyecto Maps con billing ya activo. Archivo local ignorado, ACL e inyección
Gradle con prioridad explícita y comprobación del origen de servidor; servicio,
paquete y certificado restringidos. No modificar el proyecto FCM ni producción.
No habilitar billing nuevo ni generar peticiones de navegación de prueba.
Resultado de configuración: ambos SDK habilitados en el proyecto Maps develop,
clave limitada a paquete/firma y esos dos servicios, claves anteriores intactas.
BuildConfig coincide con archivo local protegido e ignorado. Siete casos de
configuración y cinco mutaciones detectadas; APK con la misma firma previa.

## BL-104 / CP01..06 — cancelación previa al inicio y publicación selectiva

Autopsia: cancelar exige `started_at` tanto en UI como en servidor. La UI presenta republicación por mera existencia de publicación y el snapshot incluye `plan.version` en la comparación; cambios ajenos pueden republicar una ruta idéntica.

Flujo: comparar contenido propio contra snapshot publicado, excluyendo versión global y usando huellas viales por camioneta. Exponer `has_changes` y cantidad publicada en la API existente; acciones compactas según estado. Cancelación versionada conserva locks plan→publicación, revoca e incrementa revisión. La auditoría distingue retiro previo e inicio cancelado. Los triggers existentes emiten SSE y FCM tras commit. No requiere migración ni APK nueva ni consultas Google/Odoo.

| Caso | Actor / condición | Acción y resultado | Datos / auditoría / validación |
| --- | --- | --- | --- |
| CP01 | Admin, publicada sin inicio | Cancelar con modal; chofer deja de verla/iniciarla | Publicación revocada, `route.publication.cancelled`, PostgreSQL/API/UI/FCM |
| CP02 | Admin, iniciada | Cancelar conserva flujo previo y evidencia | `route.start.cancelled`, fotos intactas, regresión |
| CP03 | Admin, publicada idéntica | Sólo Cancelar; POST repetido no genera revisión ni push | Comparación semántica sin versión global, unitarias/PostgreSQL |
| CP04 | Admin, edición propia/ajena | Guardar y publicar sólo en camionetas afectadas; nuevo chofer/orden sí cuentan | Snapshot y huellas propias, sin cobros por lectura, pruebas |
| CP05 | Admin/chofer concurrentes | Serializar cancelar vs inicio; una publicación revocada no inicia | Locks/versiones, 401/404/409, QA concurrente |
| CP06 | Admin, ruta vacía/republicación | Puede retirar publicación aunque borrador no tenga pedidos; republicar vuelve a notificar | Draft/fotos conservados, revisión creciente, E2E |

Referencia: documentación local Next Route Handlers e instrumentación; contratos reales `route_plan_publications`, `route_mobile_push_deliveries` y `vehicle_input_hashes`. Seguridad: sólo API admin autenticada, no acción móvil de cancelación; sin nuevas credenciales. Recuperación: mantener borrador y republicar explícitamente. Veredicto local: GREEN LIGHT para implementación, INTEGRITY TOTAL, MATCH PERFECT con CP-T01..03. Riesgo externo pendiente: smoke de retiro en teléfono tras Deploy del usuario.

## BL-103 / PN01..09 — push de publicación y retiro, 23/09/2026

Autopsia: el canal SSE existente cubre sólo la app abierta; Android puede suspenderlo o matar el proceso. No existe registro FCM, cola de envíos ni credencial de servidor. Ya hay transacciones de publicación y cancelación y el dashboard móvil autorizado es la fuente de verdad. Se registró una app Android real del paquete `com.five.anarutas.driver` en Firebase develop; no se toma el proyecto Firebase como base de datos de rutas.

Diseño: trigger transaccional crea entregas por dispositivo registrado al insertar/republicar/retirar una publicación, sin disparar en `started_at`. Reasignación crea retiro para el chofer anterior y publicación para el nuevo. El worker toma filas con lease y `SKIP LOCKED`, verifica dispositivo/acceso y vigencia de la publicación, usa HTTP v1 con OAuth de cuenta de servicio y elimina credenciales inválidas; reintenta sólo fallos transitorios con retroceso. Payload mínimo `event`, `planId` y `revision`, sin pedidos. Android registra su FID al autenticar, pide permiso Android 13+, muestra aviso nativo y sincroniza dashboard al abrir/recibir. Entrega no es garantía de tiempo real si el SO restringe red o el usuario niega permiso.

| Escenario | Resultado esperado |
| --- | --- |
| PN01 publicar ruta propia | una intención por dispositivo del chofer, aviso nativo tras commit |
| PN02 rollback o publicación idéntica | ninguna intención nueva |
| PN03 retirar/cancelar | aviso de retiro, ruta desaparece al releer dashboard |
| PN04 reasignar | aviso de retiro al chofer anterior y de ruta al nuevo, sin cruce de datos |
| PN05 inicio/foto/cambio ajeno | ningún push de ruta |
| PN06 cierre/revocación/FID inválido | no enviar más al dispositivo afectado; otro dispositivo no se altera |
| PN07 caída FCM/reinicio/doble worker | reintento durable, sin doble claim; estado final siempre del dashboard |
| PN08 app cerrada/permiso denegado | con permiso: bandeja y apertura; sin permiso: dashboard al abrir, sin prometer bandeja |
| PN09 evento obsoleto/cambio de fecha | descartar aviso obsoleto y mantener nueva ruta/fotos del día correctas |

Puertas: pruebas unitarias de decisión y contratos, PostgreSQL real para trigger/aislamiento/rollback/concurrencia, HTTP autenticado, Android JVM e instrumentación física por el usuario, cobertura crítica y mutation testing. Credencial de servicio y permiso HTTP v1 se validan en develop sin tocar producción. No publicar datos privados en logs. SLO propuesto: p95 de la cola <60 s con FCM sano; alerta si hay entregas pendientes >5 min; tasa de fallo permanente y reintentos medidos. No se certifica entrega física sin la prueba del teléfono del usuario.

## BL-102 / MN01..08 — ruta en vivo para la APK abierta

Diagnóstico: la APK sólo consulta al abrir y cada 30 s. La publicación sí genera una señal transaccional global para el panel, pero no existe un canal móvil. Una señal global no autoriza enviar datos de otros choferes.

Flujo: tras `LISTEN`, `GET /api/mobile/events` valida el token móvil, calcula la huella de publicaciones visibles exclusivamente para ese chofer y emite `reset`. Los cambios de PostgreSQL se coalescen; sólo una huella distinta emite `change` sin datos privados. La APK relee `/api/mobile/dashboard` como fuente de verdad, reconcilia ruta/versión y muestra aviso de asignación nueva o modificada. Reconexión y consulta periódica recuperan cortes y cambios de día. Latidos validan revocación, sin extender sesiones. Nada invoca Google/Odoo.

| Escenario                             | Resultado                                                        | Validación         |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------ |
| MN01 Publicación propia confirmada    | Cambio inmediato, dashboard actualizado y aviso local            | PostgreSQL/Android |
| MN02 Cambio ajeno o rollback          | Cero evento de ruta propia                                       | PostgreSQL         |
| MN03 Republicación idéntica           | Cero aviso duplicado                                             | PostgreSQL/Android |
| MN04 Retiro o reasignación            | Ruta anterior deja de ser visible                                | PostgreSQL/Android |
| MN05 Corte, reinicio o evento perdido | Reset al reconectar y consulta de respaldo                       | HTTP/Android       |
| MN06 Sesión revocada/expirada         | Cierra canal, sin datos privados                                 | HTTP               |
| MN07 Ráfaga y lectura ocupada         | Una actualización pendiente no se pierde                         | Unitarias/Android  |
| MN08 App cerrada                      | Push remoto pendiente de Firebase real, nunca se promete con SSE | QA de entorno      |

Seguridad: el evento sólo contiene tipo y parámetros de latido; autorización de filas se ejecuta en el servidor. Sin cache/buffering, sin token en URL, conexión compartida a PostgreSQL. SLO de desarrollo: cambio visible <2 s con conexión sana; cero API Google/Odoo por evento. Referencias: documentación local Next 16 Route Handlers, PostgreSQL LISTEN/NOTIFY y Firebase/Android oficiales. Auditoría forense: GREEN LIGHT para canal foreground, RED ALERT para push en segundo plano hasta contar con proyecto Firebase y secreto del servidor. Integridad con BL-100: comparte listener, no cambia snapshot ni reglas de publicación. Correspondencia MN-T01..04: MATCH PERFECT para el bloque foreground.

## BL-101 / UX01..08 — rediseño nativo del chofer

Componentes Compose con tokens comunes, iconos vectoriales locales, drawer modal,
Inicio de tarjetas, listas compactas, búsqueda de pedidos y diálogos coherentes.
Logo original Five integrado como recurso local en acceso, cabecera, drawer e
icono adaptativo. Listas extensas virtualizadas; actualización manual conserva
destino y muestra fallos de red sin cerrar sesión.
La API existente es la autoridad. El ViewModel conserva mutaciones y autenticación.
Preferencia de pantalla en SharedPreferences local (sin tokens), aplicada sólo a
ruta iniciada visible; permiso de ubicación se gestiona en Ajustes Android.

| Caso                        | Datos/acción               | Resultado y prueba                                                                          |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| UX01 Inicio                 | Dashboard autenticado      | Nombre/fecha reales y cuatro accesos; estado sin ruta explícito                             |
| UX02 Drawer/atrás           | Estado de navegación local | Cierra drawer primero, vuelve a Inicio desde destinos; sin logout accidental                |
| UX03 Ruta/historial         | Snapshot publicado         | Métricas y pedidos reales; ruta anterior no se confunde con hoy                             |
| UX04 Inicio/fotos           | Mutaciones existentes      | Cinco fotos de hoy, confirmación y revisión vigente; histórico sólo consulta                |
| UX05 Pedidos                | Lista autorizada           | Búsqueda local por cliente/folio/dirección, detalle completo y sin resultados explícito     |
| UX06 Mapa persistente       | Ruta de hoy iniciada       | Sigue apuntando a ruta actual aunque se consulte otra; clave ausente explica disponibilidad |
| UX07 Preferencias           | Almacenamiento local       | Pantalla activa sólo cuando corresponde; permisos abren ajustes del sistema                 |
| UX08 Carga/fallo/revocación | Contratos existentes       | Reintento, sesión real, retiro de ruta y cambio de día mantienen sus guardas                |

Referencias oficiales: [drawer](https://developer.android.com/develop/ui/compose/components/drawer),
[accesibilidad Compose](https://developer.android.com/develop/ui/compose/accessibility/api-defaults),
[pruebas Compose](https://developer.android.com/develop/ui/compose/testing).
Targets táctiles de 48 dp con aspecto compacto, contraste alto, texto adaptable,
estados vacíos y estructura apta para más módulos reales. Sin nuevas llamadas
Google/Odoo por navegación. No se añade captura de incidencias en este bloque.
Revisión local: GREEN LIGHT para implementación; coherente con BL-088..100.
Tareas UX-T01..05 corresponden a UX01..08; MATCH PERFECT documental.

## BL-100 / RT01..08 — panel en vivo, 23/09/2026

Diagnóstico: OPTIONS live de fotos sólo permite GET/HEAD/OPTIONS; develop desplegado
no contiene el DELETE de d2841e0. Recarga real en Brave conservó sesión; no se
reprodujo pérdida inmediata. Hay expiración por inactividad a 30 minutos y máxima
a 12 horas por defecto. Inicio móvil no cambia plan.version y el panel no tiene
suscripción, por eso no refresca publicaciones.

Arquitectura: migración 18 con triggers de sentencia en tablas de negocio
verificadas; NOTIFY constante sin PII tras commit. Una conexión LISTEN compartida
por proceso/pool, nunca una por navegador. GET /api/events (cookie admin, no-store,
text/event-stream, sin buffering) valida sesión al conectar, al notificar y en
latidos. Cierre de DB/canal cierra SSE; EventSource reconecta y emite reset después
de LISTEN para releer estado y recuperar eventos perdidos. Cola acotada por
coalescencia, limpieza al abortar/desmontar/ocultar. Las consultas de cada sección
usan contratos existentes y su control de versión; no remonta formularios.

| Caso                                    | Resultado y validación                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| RT01 Inicio/cancelación/foto confirmada | Evento tras commit; panel relee publicaciones/fotos sin F5 (PostgreSQL+HTTP+E2E)                   |
| RT02 Cambio de otro admin               | Lista visible actualizada; borrador local intacto; conflicto de versión seguro (E2E)               |
| RT03 Rollback/lote                      | Cero evento por rollback; señales iguales del commit coalescidas (integración)                     |
| RT04 Corte/reinicio/ocultar pestaña     | Reconectar, reset y releer; estado de conexión visible (E2E)                                       |
| RT05 Sesión vencida/revocada            | Ningún dato privado por SSE; cierre del canal y login (HTTP)                                       |
| RT06 Panel visible                      | Latidos renuevan inactividad sin extender caducidad absoluta; F5 conserva cookie (integración+E2E) |
| RT07 Ráfaga/carrera edición             | Sin solicitudes paralelas redundantes; última invalidación no se pierde (unitaria+E2E)             |
| RT08 Incidencias futuras                | No crear incidencias falsas; auditoría transaccional queda suscrita para conectar el módulo real   |

Referencias: PostgreSQL LISTEN/NOTIFY oficial
(https://www.postgresql.org/docs/current/sql-notify.html,
https://www.postgresql.org/docs/current/sql-listen.html), MDN SSE
(https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events),
documentación local Next 16 cookies y route handlers.
Objetivo local: evento visible <2 s en conexión sana, 0 llamadas Google/Odoo,
0 filtraciones de tokens/filas, cobertura crítica por escenarios, mutación dirigida.
Riesgos: proxy live y móvil físico requieren comprobación tras Deploy manual.
Diseño revisado para RT-T01..04; resultados y límites de validación en
`QA-PANEL-TIEMPO-REAL.md`. No equivale a certificación productiva.

## Política vigente FD01..FD10 — reemplaza el armado multicandidato

`BLOQUE-FLEET-DIRECTO.md` define flujo, contratos, escenarios y recuperación.
Armar → una solicitud global Google → validar/expandir sin reordenar → guardar
su recorrido atómicamente. Prioridad es preferencia fuerte dentro del modelo,
no veto al guardar. Cero Compute Routes en éxito; fallback medido sólo si falla
Google. Las políticas de armado que siguen son históricas, no vigentes.

Política vigente: `BLOQUE-CONTROL-COSTO-FLEET-ROUTING.md`, FC08..FC14;
`BLOQUE-BUSQUEDA-GLOBAL-VIAL.md`, BL-078..082, MG01..08;
`BLOQUE-RUTEO-GEOGRAFICO-FINOPS.md`, BL-072..076;
`BLOQUE-SECUENCIA-VIAL-PRIORIDAD.md`, BL-069..071, SV01..08; y
`BLOQUE-RUTEO-DETERMINISTA.md`, BL-065..068, RD01..08.
Armar ruta no llama OpenAI: Google aporta optimización vial y Ana Rutas aplica
prioridad, ventanas, flota, balance y recorrido mediante comparación determinista.
Las distribuciones locales se preseleccionan con prioridad, ventanas y calles
medidas; el único finalista se entrega a Google como solución inicial dentro de
la única solicitud global, sin fijar camionetas ni crear precedencias masivas.
Sustituye la autoridad de OpenAI en BL-029/035/036/060 y conserva sus fronteras
transaccionales, de seguridad y persistencia.

BL-072..075 añaden una asignación geográfica balanceada por sectores contiguos
y una secuencia de fecha límite como alternativa medible, sin retirar la
propuesta global de Google ni flexibilizar cobertura, grupo de cliente o
precedencia. BL-076 corrige el contrato temporal real de BigQuery REST.

BL-078..082 incorporan tres semillas independientes —Google global, barrido
circular y clúster multicentro— y una búsqueda determinista hasta convergencia.
La vecindad mueve grupos/puntos completos entre camionetas y aplica
`relocate/2-opt` dentro de cada prioridad; toda alternativa única se vuelve a
medir con Google Routes para comparar métricas viales y guardar polilíneas. No se
fusionan clientes cercanos ni se convierte una ventana en restricción dura.

FC08..FC14 conservan el ganador local como línea base y eliminan la amplificación
de costo: una única optimización global con warm start es el máximo por armado.
Un fallo de esa llamada no bloquea el guardado, no existe reintento Fleet y un
movimiento manual consume cero Fleet Routing.

Política histórica: `BLOQUE-LOGISTICA-PRIORIDADES.md`, BL-058..062/064, LP01..20.
Prioridad por camioneta, horarios flexibles y comparación medida sustituyen
prioridad flexible BL-028/054 y confirmación inmediata V10.
BL-064 exige medir carga por pedidos/destinos y una línea base balanceada antes
de confirmar; no es un límite de capacidad ni autoriza separar un destino.

Panel Incidencias: `BLOQUE-INCIDENCIAS-LLEGADA.md`, BL-063, IN01..08.
Sólo consulta de previsiones vigentes; sin eventos de llegada ficticios ni APK.

Corrección autorizada de ruteo: `BLOQUE-RUTEO-POR-CLIENTE.md`, BL-048..050 y
RC01..10. Cliente/destino indivisible y consecutivo al armar ruta; el uso de
flota se cuenta por grupos, sin cambiar pesos, ventanas ni prioridades.

Extensión selección Odoo autorizada: `BLOQUE-SELECCION-ODOO.md`, BL-041..047,
C01..C19 y SC-T01..07. Sustituye carga ordinaria inmediata por consulta/selección/
confirmación e incluye confirmed/assigned; manual BL-015 conserva done.
MATCH PERFECT documental previo a construcción; producción 17 requiere preflight.
Evidencia de implementación y QA: QA-SELECCION-PEDIDOS-ODOO.md.

Histórico 5B: BL-032..036 y R01..14 en BLOQUE-5B-RECALCULO-IA.md sustituyeron
la obsolescencia manual S39 por recálculo automático conservando el orden, y la salida
libre por horario configurado por plan. La selección de OpenAI queda revocada por
BL-065; el recálculo manual y durable permanece sin LLM.
la precedencia Alta→Media→Por horario continúa obligatoria y cada camioneta vuelve
al punto de salida con el regreso incluido en tiempo, distancia y mapa.

## Límites

Extensión autorizada 3A: BL-011..014/O01..14, contratos y migración v3 en
BLOQUE-3-PEDIDOS.md. La elegibilidad se basa en surtidos validados; no en fecha
de creación de la venta. Ventanas y prioridad pueden permanecer pendientes.

Extensión autorizada 4: BL-018..024, contratos de directorio, compatibilidad
Odoo, preferencias, puntos y exportaciones en BLOQUE-4-CLIENTES.md. Migración
aditiva v5; no reemplaza snapshots ni reglas BL-001..017.

Extensión autorizada 2A: ver BLOQUE-2-FLOTA.md para BL-007..010 y F01..10. Nueva migración aditiva v2; no reemplaza ni elimina los contratos v1.

Aplicación Next.js/React/TypeScript nueva con API de rutas del mismo origen. PostgreSQL dedicado a Ana Rutas. Sin imports, redirecciones, proxies, migraciones ni cambios a five. Redis/worker se incorporarán con los trabajos durables en su bloque; no se requieren para autenticación y borradores persistidos.

El despliegue usa una imagen Docker standalone con configuración runtime. No existe lógica `develop`/`main` en el dominio. RUTAS_INSTANCE_ID y RUTAS_DATABASE_URL identifican la instalación; no se acepta DATABASE_URL genérica ni las conexiones del bot. El mismo código funciona con las variables del EasyPanel de cada servidor. Migraciones explícitas automáticas al arrancar, transaccionales, con bloqueo y marca de propiedad; rechazar una DB no vacía sin marca o con identidad diferente.

## Flujos y contratos

- `/login`, `/setup`: acceso público sin datos operativos. Alta inicial exige RUTAS_BOOTSTRAP_TOKEN y transacción serializada. No valor predeterminado.
- `/api/session`: POST acceso (Origin exacto + JSON), DELETE cerrar sesión; GET datos públicos de sesión.
- `/api/setup`: POST primera cuenta, una sola vez.
- `/api/users`: GET y POST para administradores. `/api/users/[id]`: PATCH activar/desactivar; prohibido desactivar la propia cuenta, evitando dejarse fuera. Cuenta inactiva invalida sus sesiones.
- `/api/plans`: GET/POST borradores por fecha. `/api/plans/[id]`: PATCH etiqueta y DELETE borrador con expectedVersion. El borrado elimina sólo pedidos/selección diaria del plan, conserva datos maestros y Odoo, y un conflicto 409 no destruye cambios ajenos.
- `/api/plans/[id]/orders/manual`: POST de folios exactos, empresa y credenciales siempre tomadas del servidor. La ausencia de fecha no relaja los demás criterios de elegibilidad.
- `/api/plans/[id]/orders`: DELETE retira un surtido del borrador con expectedVersion; no escribe Odoo y una sincronización posterior puede recuperarlo.
- `/api/odoo`: GET configuración pública mínima, POST diagnóstico real de sólo lectura. Ninguna entrada del cliente decide host, credencial, compañía ni modelo RPC.
- `/api/audit`: GET últimos eventos con autor; no contraseñas, tokens ni respuestas completas externas.
- `/api/health`: liveness mínimo sin datos; `/api/ready` consulta marca de instalación, 503 en error sin detalles sensibles.

## Seguridad

S20 / BL-002: por petición explícita del usuario, mínimo de contraseña 6 caracteres y máximo 128, tanto en alta inicial como en creación desde el panel. Se reconoce menor resistencia a adivinación frente al mínimo anterior de 15; no se declara equivalencia de seguridad. Se mantienen hashing, rate limits, sesiones, bootstrap y CSRF. No se cambian hashes existentes. Todos los administradores siguen pudiendo crear cuentas; queda descartada la propuesta de restringir esa acción al propietario. Validar límites 5/6/7/128/129, errores API sin cuenta creada, alta/login de seis caracteres y regresión de contraseñas largas.

Sesiones aleatorias 256 bits, sólo hash en PostgreSQL; cookies HttpOnly, SameSite Strict y Secure cuando HTTPS, sin atributo Domain. HTTP sólo para loopback local. Expiración absoluta e inactividad verificadas contra DB. Solicitudes mutantes verifican Origin de RUTAS_APP_ORIGIN y JSON, tamaño acotado. SQL parametrizado. Identidad del actor tomada de sesión, no del body. Scrypt 2^17/r8/p1 con sal aleatoria, comparación constante; límite de concurrencia y de intentos persistido en DB. Errores públicos por código, nunca cuerpo de Odoo o stack. CSP, no-store para datos privados, no credenciales en bundles ni imágenes.

Odoo: URL HTTPS desde entorno, sin redirects; JSON-RPC autenticado con métodos privados y específicos, tiempo máximo técnico configurable. COMPANY_ID explícito. Verificación de empresa permitida; fingerprint de URL/base/empresa para futuras claves de caché. Clave API hereda permisos del usuario: desplegar con cuenta Odoo dedicada de lectura antes de producción. El conector no expone ejecutor genérico.

## Matriz de escenarios

Todos los casos registran únicamente eventos definidos; rechazo no ejecuta mutación de dominio. QA real, sin mocks.

| ID / regla | Actor / precondición / disparador                     | Lectura/escritura            | Resultado / auditoría                    | Fallo/recuperación y prueba                     |
| ---------- | ----------------------------------------------------- | ---------------------------- | ---------------------------------------- | ----------------------------------------------- |
| S01 / 001  | Operador inicia con variables ausentes                | Sin DB                       | Error configuración, sin fallback        | Unidad config; corregir variables y reiniciar   |
| S02 / 001  | Operador apunta DB ajena o instalación distinta       | Catálogo/marker sólo lectura | Abortado, ningún DDL ajeno               | Integración PostgreSQL real                     |
| S03 / 001  | Dos procesos migran instalación nueva                 | DB propia transaccional      | Una versión instalada                    | Bloqueo transaccional; repetir sin daño         |
| S04 / 002  | Visitante intenta setup sin secreto o luego de creado | Login throttle / cuentas     | Rechazo genérico                         | E2E e integración; sin segunda cuenta           |
| S05 / 002  | Dos solicitudes válidas de setup simultáneas          | Cuenta/auditoría             | Exactamente una primera cuenta           | Integración concurrente                         |
| S06 / 003  | Admin entra en dos navegadores                        | Sesiones independientes      | Ambos acceden                            | E2E; logout uno no afecta otro                  |
| S07 / 003  | Atacante prueba clave errónea/repetida                | Throttle persistido          | Rechazo/rate limit                       | Integración; no autenticación falsa             |
| S08 / 003  | Cookie robada expirada, inactiva o sesión revocada    | Sesión/cuenta                | 401; página vuelve a login               | Integración + E2E                               |
| S09 / 003  | Solicitud sin Origin o de sitio externo               | Sin escritura dominio        | 403                                      | E2E; origin exacto no sufijos                   |
| S10 / 002  | Admin crea usuario duplicado                          | Transacción única            | 409, no duplicado                        | Integración índice único                        |
| S11 / 004  | Admin crea/reintenta borrador del día                 | Plan/auditoría               | Mismo ID sin doble creación              | Integración idempotencia concurrente            |
| S12 / 004  | Dos administradores editan misma versión              | Plan/auditoría               | Uno aplica, otro 409                     | Integración; refrescar y reconsiderar           |
| S13 / 005  | Admin diagnóstico sin config                          | Sin red                      | Estado no configurado                    | Unidad; no fallback al Odoo viejo               |
| S14 / 005  | Error/redirección/Odoo no autorizado                  | Sólo lecturas externas       | Error sanitario, nada se escribe en Odoo | Contrato estático + live opt-in; sin simulación |
| S15 / 001  | Cambio instancia/URL/DB/empresa                       | Namespacing config           | Nuevo fingerprint, no reuse de IDs       | Unidad; DB propia por instalación               |
| S16 / 006  | Instalación vacía                                     | Borradores reales vacíos     | Sin datos ni éxito inventados            | E2E panel vacío                                 |
| S17 / 003  | Reinicio de proceso                                   | Sesión DB persistente        | Sesión válida continúa                   | E2E en servidor construido                      |

## QA y métricas

### S21: conexión Odoo interna sin pantalla administrativa (BL-005, BL-006)

La configuración Odoo pertenece exclusivamente al runtime del servicio de Ana
Rutas y no se presenta como opción de navegación. Se retiran del navegador el
estado, diagnóstico y explicación de separación de entornos. El conector,
`/api/odoo`, sus controles de autenticación y sólo lectura, y los eventos
históricos de auditoría permanecen intactos para operación y QA. Las acciones
futuras como cargar pedidos invocan servicios de dominio del backend y nunca
reciben host, base, compañía o credenciales desde el cliente.

Validación S21: la navegación no contiene «Conexión con Odoo» y el endpoint
autenticado continúa respondiendo desde la configuración del proceso. No se
modifican Odoo, credenciales, datos de negocio, V3, vendedores o precios.

### S25: carga manual por folio fuera de fecha (BL-005, BL-011, BL-012, BL-015)

El modal de carga incluye una sección compacta independiente de la fecha. El prefijo
`S` es fijo y cada renglón captura su parte numérica, con `00001` como ejemplo visual,
no como pedido seleccionado. El operador puede añadir hasta 50 folios únicos y
confirmarlos como un solo lote. El servidor normaliza y valida el formato; consulta
únicamente la empresa configurada y exige ventas sale/done con surtidos done,
outgoing, destino customer, cantidades positivas y sin devoluciones. Todos los folios
deben producir al menos un surtido elegible antes de persistir cualquiera. Un folio
puede producir varios surtidos y cada combinación surtido+venta conserva su identidad.

La implementación comparte autenticación, negociación de campos e hidratación con la
carga por fecha. No ramifica por número de versión Odoo: detecta campos disponibles
mediante `fields_get` y usa el enlace stock.move.sale_line_id → sale.order.line.order_id.
El cliente nunca envía URL, base, empresa, credenciales, modelos o dominios libres.

### S26: retiro recuperable de pedidos (BL-003, BL-012, BL-016)

Cada tarjeta tiene un bote rojo accesible separado de la acción de expandir. Al
activarlo se abre un modal que identifica pedido y surtido. Cancelar, Escape o cerrar
no escriben; aceptar envía el ID interno y expectedVersion. En una sola transacción se
revalida actor, bloquea plan y tarjeta, comprueba versión, elimina la copia de Ana
Rutas, normaliza posiciones, incrementa versión y audita. No existe exclusión
permanente: volver a cargar desde Odoo puede recuperar la tarjeta eliminada.
El bote visual ocupa 21 px en la esquina superior derecha. Su área interactiva
permanece separada de nombre, horario y prioridad, y conserva 44 px en dispositivos
táctiles. Las etiquetas usan una fila propia de ancho completo y se dividen cuando el
carril no permite mostrarlas juntas; ninguna queda debajo del control destructivo.
El estado compacto «Pendiente Odoo» conserva la condición completa en el encabezado
del borrador y evita sacrificar la legibilidad del horario o de la prioridad.

### S27: cargas independientes (BL-005, BL-013, BL-015)

El modal no contiene una acción separada para guardar camionetas. «Consultar pedidos»
prepara la selección por fecha. «Confirmar pedidos» carga los folios exactos sin
consultar la fecha; transmite las camionetas marcadas y la versión del plan.
La persistencia de camionetas nuevas y surtidos manuales ocurre en una sola
transacción, sin retirar camionetas ni asignaciones existentes: un fallo de Odoo,
versión o flota no deja un lote parcialmente guardado. Cada acción conserva
indicador visual de progreso y exclusión mutua.

### S39A: publicación de secuencia manual sin optimización (BL-030)

Arrastrar o reordenar pedidos mantiene exactamente la camioneta y secuencia elegidas.
Antes del primer recorrido, los movimientos no llaman Google: abrir el mapa de un
borrador completo encola automáticamente una sola medición vial durable para esa
versión. Reabrirlo reutiliza el resultado o el trabajo pendiente; un fallo requiere
reintento explícito y un borrador sin bodega, salida o puntos confirmados no consume
Google. La publicación confirma por separado y reutiliza el recorrido vigente.
Después, cada movimiento
encola un recálculo durable y coalescible, sin Fleet Routing y sólo para la camioneta
afectada (origen y destino si se transfiere un pedido); los carriles intactos reutilizan
su último recorrido. La migración v16 guarda huellas por camioneta; recorridos previos
sin huellas se recalculan completos una sola vez por seguridad. La medición de Google
Routes incluye bodega→paradas→bodega y tiempos posteriores al punto alterado. La UI
espera el resultado y publica solamente si la versión, puntos, salida, flota y cobertura
siguen vigentes. Si el navegador se cierra, el
cálculo durable puede terminar, pero no se publica sin una confirmación activa;
repetir la confirmación reutiliza el recorrido vigente y no duplica la medición.
Una ruta ya iniciada conserva su snapshot y nunca se reordena. «Armar ruta» sigue
siendo la optimización opcional que sí puede cambiar el acomodo.

### S28: mismo pedido en varios planes (BL-012, BL-013)

La identidad persistente es plan+fingerprint+surtido+venta. Una recarga dentro del
mismo plan es idempotente y conserva posición/asignación. La misma identidad Odoo
puede insertarse en cualquier número de planes, donde cada copia se mueve o elimina
sin afectar las demás. La migración v4 reemplaza la restricción global sin eliminar
datos y continúa fijando un solo origen Odoo por instalación.

### S29: eliminación completa de borrador (BL-003, BL-004, BL-017)

Una acción roja «Borrar plan» abre un diálogo accesible con nombre, fecha e impacto.
Cancelar, cerrar o Escape no escriben. Confirmar envía expectedVersion; el servidor
revalida al actor, bloquea el plan, comprueba versión, cuenta y elimina primero sus
pedidos y selección diaria, elimina el plan y registra `plan.deleted` con cantidades.
No elimina flota, choferes, usuarios, auditoría ni escribe Odoo. La interfaz retira el
plan del selector y abre otro disponible o el estado vacío.

### S30: editor de clientes ocultable (BL-025)

El panel derecho de Clientes y horarios incorpora una acción secundaria «Ocultar».
Sin cambios pendientes, la acción no escribe datos, conserva la selección y devuelve
todo el ancho disponible al directorio. Con cambios pendientes pide confirmación:
cancelar mantiene exactamente el formulario abierto y aceptar descarta sólo el estado
local no guardado antes de ocultarlo. Búsqueda, paginación y sincronización respetan el
estado oculto; seleccionar cualquier fila abre nuevamente el editor con su versión
vigente. La barra operativa contiene Actualizar clientes y Exportar Excel, pero no
Importar Excel; la carga inicial desde archivos permanece como migración controlada
con preflight y no como escritura libre desde el navegador. Los controles Archivar y
Quitar ventana miden 28 px visuales en escritorio, sin transformaciones, y recuperan
un objetivo mínimo de 44 px en pantallas estrechas o dispositivos de puntero grueso.

### S31: prioridad visual consistente en el planificador (BL-023)

La tarjeta cerrada de cada pedido conserva el valor resuelto por el contrato de
clientes y aplica el mismo lenguaje visual del directorio: Alta usa amarillo, Media
usa azul y Por horario permanece neutra. El texto siempre acompaña al color para que
la distinción no dependa únicamente de percepción cromática. Este ajuste no modifica
orden, asignación, ventanas, snapshots ni persistencia; el navegador valida las
clases semánticas y sus colores calculados.

### S19: densidad compacta del panel (BL-006)

Reducir tamaños y espacios dentro del panel autenticado, sin reducir mediante zoom/transform ni alterar login, formularios, API o datos. Escritorio: controles de 34–36 px, título principal de 24 px, títulos de tarjeta de 16 px, rellenos de 12–16 px y estados vacíos sin grandes alturas forzadas. Dispositivos táctiles: objetivos de pulsación de al menos 44 px y campos de 16 px para lectura. Mantener contraste, foco, texto completo, adaptación y ausencia de desbordamiento. Validación T09 con dimensiones calculadas, screenshots en 375/768/940/1024/1440 px y recorrido E2E existente. Sólo CSS y pruebas/documentación.

### Ajuste aprobado: edición explícita del nombre (S18 / BL-004, BL-006)

Al crear o abrir un borrador, su nombre ya guardado se muestra como título, con una acción secundaria «Cambiar nombre». No se muestra un formulario de guardado permanente. La acción abre un campo enfocado con el nombre actual, «Guardar cambios» y «Cancelar». Cancelar o Escape descarta la edición local sin solicitudes; el foco vuelve a la acción. Guardar mantiene el PATCH existente con expectedVersion, permisos y auditoría; sólo el éxito cierra la edición. Un conflicto conserva el texto y muestra el error existente. Cambiar de borrador reinicia el editor; no se permite cambiar de borrador mientras se guarda. No se modifican cuentas, Odoo, migraciones ni otros flujos.

Validación S18: unidades de presentación/escape de texto; navegador real con PostgreSQL para apertura, cancelación, teclado, persistencia, conflicto concurrente, cambio de borrador y tamaños 375/768/1024/1440. Se conservan las pruebas existentes de seguridad e idempotencia. GREEN LIGHT para este ajuste acotado; T08 en PROGRESS corresponde a S18, sin nueva integración.

### Estado de validación Odoo integrado al encabezado (S41 / BL-006)

El conteo persistente de pedidos pendientes de validación deja de ser una
notificación flotante. El tablero sigue calculándolo desde el estado real de cada
pedido y lo publica dentro del encabezado del borrador, antes de su versión, sin
temporizador ni superposición sobre tarjetas. Un conteo cero no presenta el estado;
el singular y el plural corresponden al valor recibido. En pantallas angostas el
estado ocupa una segunda línea dentro del mismo encabezado y nunca sale del flujo.

Validación S41: unidad de presentación para cero, uno y varios pendientes; navegador
real con PostgreSQL para comprobar su ubicación dentro del encabezado y ausencia en
el contenedor de avisos flotantes; typecheck, lint y build. La corrección no consulta
ni escribe Odoo, no cambia la API, la persistencia, el armado de ruta ni las
notificaciones transitorias de operaciones.

Build/types/lint; auditoría npm; unidades para configuración/seguridad; integración con servidor PostgreSQL real local desechable; E2E login/setup/borrador/acceso; Gherkin; mutation testing para predicados críticos. Objetivo por riesgo: 100% de predicados de autorización/origin/expiración y al menos 85% líneas en core; no declarar verde por promedio si falta escenario crítico. Registrar latencias y errores reales sin afirmar SLO de producción desde localhost. No commit/push/deploy hasta evidencia o excepción aprobada.

## Veredicto previo

GREEN LIGHT: construcción del bloque 1 local autorizada, con interfaces que no mezclan dominios. MATCH PERFECT: BL-001..006 y S01..17 tienen tareas en PROGRESS. Esto NO certifica el software aún no construido ni habilita producción. Integración Odoo live, imagen Docker en Linux, backup/restauración y configuración de servidores requieren validación antes de despliegue.

## Batch 5: BL-026 a BL-030 — optimización vial

### Requirements Covered

Salida única confirmada; optimización sin peso/capacidad; preferencias de ventana y
prioridad sin omisiones; tráfico, asignación, orden, ETA, distancia, polilínea y tokens
por transición; aplicación versionada y resultado obsoleto tras edición manual. La
autoridad operativa vigente está formalizada en BL-054.

### Scenario Matrix

| ID  | Actor / precondición                     | Disparador          | Lectura/escritura    | Resultado                                        | Fallo y recuperación                                   |
| --- | ---------------------------------------- | ------------------- | -------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| S32 | Admin, Maps activo, salida sin confirmar | Abre configuración  | Runtime + settings   | Dirección sugerida, ningún punto inventado       | Puede cerrar sin escritura                             |
| S33 | Admin con salida vigente                 | Confirma otro punto | Settings/auditoría   | Versión y liga regeneradas                       | 409 conserva edición ajena                             |
| S34 | Plan con flota/pedidos/puntos            | Armar ruta          | Google→Ana Rutas→DB  | Mejor candidato completo aplicado atómicamente   | Segunda Fleet falla: guarda la línea base completa     |
| S35 | Ventanas/prioridades mezcladas           | Resolver modelo     | Route Optimization   | Lote completo; conflictos medidos como avisos    | Operador conserva autoridad sobre las salidas          |
| S36 | Otro admin cambia el plan durante Google | Aplicar respuesta   | Lock/version         | 409; resultado no aplicado                       | Actualizar y decidir de nuevo                          |
| S37 | Google omite un pedido                   | Aplicar solución    | Runs/stops/shipments | Respuesta parcial rechazada; cero escritura      | Base balanceada completa se mide por vialidad          |
| S38 | Ruta vigente                             | Ver mapa            | Run vigente          | Recorrido, ETA, km y duración reales             | Sin run vigente muestra puntos, no ruta falsa          |
| S39 | Ruta vigente                             | Movimiento manual   | Plan/job/version     | Conserva acomodo y recalcula calles/ETA          | Reintento durable sin redistribución                   |
| S40 | Origen incompleto o ambiguo              | Ubicar domicilio    | Google Geocoder      | Referencia visible; confirmar bloqueado          | Completar dirección o marcar punto exacto              |
| S41 | Existen pendientes de validación Odoo    | Cargar tablero      | PostgreSQL local     | Conteo dentro del encabezado, sin cubrir pedidos | Cero lo oculta; ancho angosto lo acomoda en otra línea |

### Data Flow

El servidor obtiene configuración y snapshot desde PostgreSQL. Una primera
solicitud Google Route Optimization recibe coordenadas, ventanas flexibles y
demandas blandas dinámicas. Ana Rutas compara esa semilla con balance circular y
clúster multicentro mediante prioridad, ventanas y Google Routes. Sólo el ganador
fija sus destinos a camionetas, genera precedencias Alta→Media→Por horario dentro
de cada unidad y puede pedir una segunda y última optimización de secuencia. Antes
de fijar cada reparto consolida en una misma camioneta todos
los clientes con la misma coordenada confirmada, sin fusionar sus identidades.
Compara prioridad, ventanas, uso de flota, costo combinado de conducción y jornada
máxima, viaje, distancia y después equilibrio/carga, valida cobertura y versión,
y sólo entonces aplica. El navegador recibe un contrato sanitizado; los route
tokens permanecen privados para el endpoint de conductor futuro. Ningún LLM
participa. Mover pedidos manualmente recalcula ETA/tramos sin Fleet Routing.

### Tables / APIs / Tools

Migración v7 y contratos históricos definidos en `BLOQUE-5B-RECALCULO-IA.md`.
`BLOQUE-SECUENCIA-VIAL-PRIORIDAD.md` corrige el ordenamiento posterior: Route
Optimization aporta reparto y secuencia condicionada por precedencias reales;
Ana Rutas decide por score reproducible y Routes API mide cada tramo, incluido
el regreso a bodega.

### Permissions / Tenant Boundaries

Cuenta de servicio exclusiva por instalación con `roles/routeoptimization.editor`.
Proyecto, JSON y claves sólo en EasyPanel. Una instalación no acepta un `project_id`
distinto al configurado.

### Integrations / Costs / Limits

Timeout del solver dinámico por tamaño; sin abortos temporales locales arbitrarios según BL-052; tamaño de respuesta acotado; métricas de
latencia/errores por código; cuotas y facturación observadas en Google Cloud. Polilíneas
y tráfico se piden únicamente al confirmar Armar ruta.

### Security / RLS / Secrets

Sesión y Origin existentes; host Google fijo; modelo no controlable por cliente; secretos
ausentes de JSON público, logs y DB. PostgreSQL dedicado conserva aislamiento de la
instalación.

### Failure Modes / Recovery / Validation

Los casos S32..S39, pruebas unitarias, integración PostgreSQL, contrato fetch, E2E,
cobertura y mutación son obligatorios. Veredicto forense: GREEN LIGHT. Auditoría
incremental: INTEGRITY TOTAL; la migración es aditiva y no altera Odoo, clientes,
flota ni borradores anteriores. MATCH PERFECT con tareas O-T01..O-T07 de PROGRESS.

## Batch 7: BL-037 a BL-040 — control de consumo oficial de Google

La especificación normativa, escenarios G01..G10, flujo, migración v8, API, IAM,
seguridad, costo, calidad y referencias se encuentran en
`BLOQUE-5C-CONSUMO-GOOGLE.md`. La fuente confirmada será Cloud Billing en BigQuery;
PostgreSQL sólo cacheará snapshots reemplazables y jamás incrementará consumo.

Veredicto forense: GREEN LIGHT. Auditoría incremental: INTEGRITY TOTAL. Correspondencia
de construcción: MATCH PERFECT con G-T01..G-T07 de PROGRESS.

## Batch 8: BL-083 a BL-087 — identidad móvil y ruta asignada

### Requirements Covered

`BLOQUE-APK-CHOFER-ACCESO.md` es la fuente normativa de BL-083..087 y
M01..M14. El primer bloque entrega credenciales de chofer independientes,
enrolamiento automático de dispositivo, sesión móvil, API filtrada y una APK inicial que
sólo muestra acceso y ruta. No habilita todavía traspaso, entrega ni cobro.

### Scenario Matrix

M01..M04 cubren alta, teléfono único, PIN y primer acceso automático;
M05..M09 cubren prueba del dispositivo, concurrencia, bloqueo y revocación;
M10..M13 cubren aislamiento y vigencia de la asignación/cálculo; M14 define
la frontera offline. Cada fila del documento normativo identifica datos,
auditoría, validación y recuperación.

### Data Flow

Admin autenticado configura una credencial móvil sin incluir el PIN en la
ficha del chofer ni en `creation_payload`. La APK crea su par de claves Android
en el primer acceso y presenta teléfono/PIN y una clave pública validada.
Después firma un desafío de un uso para iniciar sesión. La API móvil resuelve
el chofer desde esa sesión y consulta los planes/carriles/pedidos actuales
según `route_plan_vehicles` y `route_shipments`; el móvil no elige identidad.

### Tables / APIs / Tools

Migración aditiva v10: credenciales, dispositivos, activaciones históricas,
desafíos, sesiones y auditoría móvil propias. La tabla histórica se conserva
inerte para evitar una migración destructiva. La v11 normaliza teléfonos
mexicanos a diez dígitos y los protege con una restricción. Endpoints administrativos para configurar
y revocar acceso; endpoints móviles separados para enrolar, desafiar, iniciar/
cerrar sesión y consultar la ruta. Ninguno comparte la cookie administrativa.
El PIN derivado requiere un secreto de servidor en configuración runtime.

### Permissions / Tenant Boundaries

Sólo cuentas admin activas configuran el acceso. El chofer activo accede sólo
al carril cuyo `driver_id` en ese plan sea el suyo; no basta con mandar
`driver_id`, `plan_id` o `vehicle_id` desde la APK. Discrepancia entre la
asignación actual de flota y el snapshot del plan se presenta para resolución
administrativa y jamás concede acceso por la fuente más permisiva.

### Integrations / Costs / Limits

No usa Odoo, Google, SMS ni Fleet Routing. El enrolamiento es interno;
la carga de ruta usa PostgreSQL de Ana Rutas. La futura navegación in-app y
los traspasos se especificarán y costearán en otro bloque.

### Security / RLS / Secrets

PIN de cuatro dígitos se combina en el primer acceso con teléfono canónico,
limitación persistida y clave pública; después se exige prueba de dispositivo,
revocación y sesiones acotadas. PIN/clave privada fuera de logs, auditoría y respuestas de
listado. Clave privada sólo en Android Keystore. Validación y versionado de
credenciales; integración con la marca de instalación PostgreSQL existente.

### Failure Modes / Recovery / Validation

Error de red, PIN erróneo, enrolamiento repetido, duplicidad de teléfono,
chofer inactivo, plan reasignado y ruta obsoleta tienen estado explícito.
Pruebas unitarias, PostgreSQL real, carrera de enrolamiento, aislamiento entre
choferes, Gherkin, API, Android, cobertura/mutación y revisión de seguridad.
Veredicto previo: GREEN LIGHT para identidad/lectura; no autoriza a marcar
completos los bloques móviles posteriores. Auditoría incremental:
INTEGRITY TOTAL. Correspondencia documental: MATCH PERFECT con M-T01..M-T06
de `PROGRESS.md`.

## Batch 9: BL-088 a BL-095 — publicación e inicio móvil

`BLOQUE-APK-RUTA-PUBLICACION.md` es la especificación normativa de MR01..17.
Separa por camioneta el borrador editable del snapshot publicado que lee la APK.
El inicio requiere publicación, identidad/asignación vigente al empezar y cinco
a ocho fotos válidas de la fecha local de servicio; congela responsable,
pedidos y secuencia de esa ruta, no las demás. La asignación persistente de
flota puede cambiar para planes futuros sin transferir la ruta iniciada.
Metadatos de fotos en PostgreSQL y WebP en volumen privado con limpieza a los
quince días. Navigation SDK provee los giros reales; la UI del mapa nunca los
inventa ni reoptimiza la flota al abrirse.

La matriz de escenarios, flujo, datos, permisos, integraciones, costos, fallos,
recuperación y validación están detallados en ese bloque. Veredicto forense:
GREEN LIGHT para construir localmente por bloques; no certifica integración
Google/volumen/dispositivo. Auditoría incremental: INTEGRITY TOTAL con BL-030
y acceso móvil 1. Correspondencia documental: MATCH PERFECT con MP-T01..MP-T08
de `PROGRESS.md`.

## Batch 10: BL-096 a BL-098 — captura contemporánea y salida deliberada

La APK usa exclusivamente la captura de cámara de Android hacia un archivo temporal privado; no solicita medios existentes. El servidor transforma a WebP y compara su hash normalizado contra fotos vigentes de la misma unidad, serializando cargas concurrentes. Una repetición de la misma ruta/fecha es idempotente y no aumenta el conteo; el mismo contenido de otra fecha o plan se rechaza. La UI de fotos se abre sólo tras una lectura exitosa del endpoint, y distingue 404 HTML de versión antigua de `NOT_FOUND` de autorización. La retención sigue visible sólo en Control de unidades.

| Escenario | Actor, precondición y disparador                                      | Datos/permisos, resultado y recuperación                                                                                                                      |
| --------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MR18      | Chofer publicado toca Fotos y el servidor ejecuta un commit anterior  | GET devuelve HTML 404; la APK no abre un modal vacío ni intenta subir; muestra actualizar develop. No cambia BD.                                              |
| MR19      | Chofer cancela cámara, la cámara falla o entrega archivo vacío        | Se limpia caché temporal; cero POST, cero foto contabilizada; permite reintento.                                                                              |
| MR20      | Chofer repite imagen en la misma ruta o intenta reutilizarla otro día | En el primer caso se informa duplicado sin sumar; en el segundo el servidor devuelve 409 sin exponer datos de otra ruta. Carga concurrente no evade la regla. |
| MR21      | Chofer toca Iniciar por error y cancela                               | Diálogo muestra paradas reales; ninguna llamada de inicio ni cambio de estado.                                                                                |
| MR22      | Admin republica mientras el chofer confirma                           | POST incluye revisión esperada; 409 y actualización necesaria, sin arrancar otra secuencia.                                                                   |
| MR23      | Develop aún no tiene volumen privado                                  | GET puede listar metadatos; la carga e inicio fallan cerrados con error de almacenamiento hasta configurar un volumen persistente.                            |

Flujo: cámara → archivo en caché privada → POST autenticado con límite → validación, deduplicación y auditoría en PostgreSQL → WebP privado; confirmación → POST con revisión → bloqueo transaccional de publicación → foto/fecha/asignación → inicio. No se llama Odoo ni Google al capturar o confirmar. Permisos: sesión móvil y publicación vigente, lectura administrativa separada. Fallos de red preservan el conteo del servidor; reintento idéntico no crea otra foto. Verificación: unitarias Android, integración PostgreSQL, HTTP/E2E, Gherkin, cobertura y mutación de duplicado/revisión, inspección física pendiente. No se declara infalsificable el origen de los píxeles en un dispositivo comprometido.

Veredicto documental: GREEN LIGHT para implementación local; INTEGRITY TOTAL con BL-090..093; MATCH PERFECT con MP-T09..MP-T12 en `PROGRESS.md`.

## Batch 11: BL-099 — descartar foto de salida antes del inicio

### Requisitos y flujo

La sesión móvil autenticada solicita `DELETE /api/mobile/unit-photos/[photoId]`. El servidor valida UUID y propietario sin revelar fotos ajenas, bloquea plan y publicación con el mismo orden que la carga y el inicio, exige publicación vigente de la unidad y ruta **no iniciada**, y borra sólo la foto de esa fecha de servicio. El borrado y su auditoría se confirman en PostgreSQL antes de retirar el WebP privado; si el archivo ya no existe o no puede borrarse, queda inaccesible y el limpiador de huérfanos lo reintenta. El conteo móvil se consulta otra vez al terminar. No hay llamada a Odoo ni Google ni migración de esquema.

### Matriz de escenarios

| ID   | Actor/precondición/disparador                                      | Datos, permiso y resultado                                                                                                                                                           | Auditoría/efecto/fallo/validación                                    |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| MR24 | Chofer publicado toca una foto borrosa y confirma                  | Elimina sólo su foto previa al inicio; GET/lista dejan de mostrarla; el conteo baja y el umbral de cinco se reevalúa                                                                 | Un evento `mobile.unit_photo.deleted`; prueba PostgreSQL, HTTP y APK |
| MR25 | Chofer cancela confirmación                                        | Cero petición, cero escritura; conserva foto y conteo                                                                                                                                | Prueba de política/UI Android                                        |
| MR26 | Ruta ya iniciada o inicia al mismo tiempo                          | La misma publicación serializa ambas acciones; si inició primero, 409 y foto intacta; si borró primero y quedan menos de cinco, el inicio falla                                      | Carrera PostgreSQL y error accesible en APK                          |
| MR27 | Sesión revocada, foto ajena, vencida o publicación retirada        | 401/404 sin revelar propietario ni archivo; cero borrados                                                                                                                            | HTTP y aislamiento de filas                                          |
| MR28 | Archivo privado ausente, fallo de disco o respuesta de red perdida | La validación de almacenamiento falla antes de borrar; tras commit el metadato ya no da acceso y el huérfano se limpia luego. La APK relee el conteo para resolver un éxito incierto | QA de fallo de almacenamiento y recuperación                         |

### Seguridad, límites y validación

El UUID nunca se usa como ruta arbitraria; el archivo sigue el nombre privado derivado del ID. No se ofrece borrar desde Control de unidades. Máximo ocho y mínimo cinco siguen siendo reglas del servidor. La acción de la APK es pequeña, accesible y sólo aparece antes del inicio; la confirmación muestra la foto específica. Objetivo: cero fotos ajenas borradas, cero rutas iniciadas con menos de cinco por carrera, cero WebP accesibles tras borrar, cobertura de los predicados de permiso/estado y mutation testing dirigido. El smoke físico y el despliegue quedan pendientes de develop.

Veredicto forense: GREEN LIGHT para el bloque local; INTEGRITY TOTAL con BL-090, BL-092 y BL-093; MATCH PERFECT con MP-T13..MP-T15 en `PROGRESS.md`.
## BL-147 — bloque aprobado: captura compacta y hasta tres evidencias

Causa comprobada: ProductIncidentSheet mantiene un único photoPath; cada captura
descarta el anterior. Preview de ancho completo y espaciado heredado alejan las
acciones. Faltantes usan AppAction en vez de IncidentChoiceCard. API, recibo,
outbox y BD también admiten una sola imagen: no basta cambiar presentación.

| Escenario | Resultado / control | Prueba |
| --- | --- | --- |
| PI15 Capturar 1/2/3 fotos; quitar cualquiera | Miniaturas independientes, X local, cuarta bloqueada; una suficiente | JVM/Compose/HTTP |
| PI16 Cancelar cámara/rotar/error/envío incierto | No reemplazar otras; lote durable, mismo recibo, no duplicados | JVM/PG/QA físico |
| PI17 Clasificar y comentar | Ventas y conceptos permitidos; chips + nota sin duplicación | Unit/PG/Excel |
| PI18 APK anterior y registros anteriores | Una imagen y recibo antiguo siguen válidos; no modificar histórico | PG/contrato |
| PI19 Foto inválida/cuarta/sesión ajena | Rechazo completo; ninguna incidencia parcial ni foto pública | HTTP/PG |
| PI20 Faltantes seleccionables | Cuatro tarjetas homogéneas; elegir no envía; modal específico | Compose |
| PI21 Lectura/archivo/resolución | Todas las fotos permanecen; sólo acceso administrativo | PG/E2E |

Flujo: formulario v2 → multipart acotado (3 × 8 MB + metadatos) → saneado
secuencial → transacción existente/recibo → foto principal legacy + tabla de
extras posiciones 2/3. Migración aditiva v28, FK e inmutabilidad. Rollback de
binario requiere compatibilidad de versión de esquema; no ejecutar downgrade.
Hashes ordenados enlazan el lote al recibo. No cambiar hash de solicitudes legacy.
Clasificación/comentarios explícitos v2; v1 continúa con sus valores anteriores.
Fotos borradas sólo del borrador; outbox protegido mientras se confirma envío.
Panel lee extras por incidencia autenticada; limpieza de huérfanos reconoce extras.
Referencia: Next16 local route-handlers/use-client; contratos PG/outbox del repo.
GREEN LIGHT / INTEGRITY TOTAL / MATCH PERFECT con PI-T07..10. Se integra
con BL-148 en develop; sin Deploy. UI conserva DriverColors y controles accesibles.
## BL-148 — edición/cancelación de incidencias y saldo visible

| Caso | Resultado verificable |
| --- | --- |
| PI22 Enviar y volver a abrir | «Incidencia enviada», datos vigentes y opción de editar/cancelar; no segunda alta implícita. |
| PI23 Editar un campo | «Guardar incidencia»; versión CAS, recibo idempotente y cambio auditado. |
| PI24 Cancelar por petición del cliente | Confirmación explícita; conserva evidencia e historia, deja de afectar saldo y exportación. |
| PI25 Dos o más incidencias en una partida | Saldo agregado exacto; no negativo; triángulo ámbar y acceso individual a cada incidencia. |
| PI26 Faltante no publicado | Renglón separado con alerta, edición y cancelación; ninguna partida publicada pierde cantidad. |
| PI27 Carrera, sesión ajena, pedido cerrado, reintento | Rechazo atómico o mismo recibo; cero cambio parcial y ninguna incidencia ajena editable. |

Migración aditiva v29: estado cancelado, bitácora inmutable, campos de formulario vigentes y validación de cantidad para INSERT/UPDATE. API móvil autenticada de enmienda y cancelación; misma outbox durable y bloqueo de visita/pedido. Los cambios de fotografía posteriores al envío quedan fuera de este bloque: fotos ya enviadas permanecen privadas y auditables. Publicación sólo en develop; el despliegue lo hace el propietario.

## BL-149 — correcciones de campo, APK 0.8.3

| Caso | Actor / disparador | Resultado y validación |
| --- | --- | --- |
| PI28 | Chofer abre/envía una cantidad 2.000000 o 0.125000 | Presenta 2 o 0.125, conserva precisión y estado enviado; JVM y Compose. |
| PI29 | Chofer captura cualquiera de los dos faltantes | Producto + cantidad faltante/unidad, sin segunda cantidad ni evidencia; sólo comentario de producto ausente y notas; JVM/Compose/HTTP. |
| PI30 | Chofer reabre un faltante anterior | Conserva comentarios anteriores y evidencia en servidor; no exige foto ni cambia recibos pendientes; regresión PG. |
| PI31 | Chofer cancela; administrador consulta panel | Filtro SQL excluye canceladas antes de contar/paginar, conserva registro/auditoría/fotos; PG, API y E2E de actualización automática. |
| PI32 | Administrador atiende una reposición | Icono Resolver verde del tema; acción y permisos existentes; E2E CSS y resolución real. |

Flujo: formateador decimal sólo al leer → controles Android según tipo manual/publicado → contrato v2 existente; consulta autenticada PostgreSQL excluye canceled en cada modo → panel/Excel. Sin nueva migración ni servicios externos. Permisos, CAS, recibos y auditoría mantienen BL-148. No eliminar históricos; reversión de binario posible sin downgrade. Referencias locales: ProductIncidentPolicy/Sheet, readProductIncidents y guía CSS de Next instalada. GREEN LIGHT / INTEGRITY TOTAL / MATCH PERFECT con PI-T16..18; BL-149 sustituye la visibilidad de canceladas y la captura opcional de fotos de faltantes de los bloques anteriores.

## BL-150 — bote administrativo en Incidencias

| Caso | Actor / disparador | Resultado, auditoría, validación |
| --- | --- | --- |
| PI33 | Administrador confirma eliminar pendiente/resuelta | DELETE autenticado con versión; estado canceled, revisiones +1, registro before/after y route_audit; PG/E2E. |
| PI34 | Chofer edita/cancela mientras admin elimina | Bloqueos ejecución → parada → pedido → incidencia; una operación gana, otra recibe conflicto; PG concurrente. |
| PI35 | Reintento de eliminación confirmada | Mismo admin y versión original obtienen duplicate=true; no segundo evento ni revisión; PG/HTTP. |
| PI36 | Sin sesión, chofer, admin inactivo u origen ajeno | 401/403; sin datos ni mutación; PG/HTTP. |
| PI37 | Registro cancelado legado o resuelto | Migración 29→30 conserva cancelador chofer y auditoría; admin queda en canceled_by_admin; resolución previa preservada en before_record; PG. |
| PI38 | Pedido delivered/rescheduled, admin elimina | report_removed_at/by excluyen el reporte, sin cambiar estado de incidencia, cantidad, resolución ni revisiones operativas; PG/E2E y concurrencia con entrega. |

Migración aditiva v30: canceled_by_admin y report_removed_by → route_users, report_removed_at; exactamente un tipo de cancelador por cancelación y autor/fecha de exclusión juntos. Servicio bloquea ejecución/parada/pedido antes de incidencia, valida CAS y lee el estado de pedido bajo el mismo bloqueo. Si cerrado, sólo retira del reporte; si abierto, cancela y limpia campos de resolución vigentes (conservados en bitácora). Consultas filtran exclusión antes de contar/paginar. Proyección móvil conserva cantidad/estado de excluidas de pedidos cerrados y las deja de sólo lectura, también tras reintento de reprogramado. UI agrega confirmación con ambos efectos, retorno ante error/conflicto y refresh. API DELETE /api/incidents/products/[id] usa principal/body existentes (sesión, mismo origen, límite de JSON). No modifica Odoo, publicación ni estado de entrega. Riesgo de despliegue: el binario anterior no reconoce schema30, rollback requiere binario compatible. GREEN LIGHT / INTEGRITY TOTAL / MATCH PERFECT con PI-T19..20 (PI33..38).

### BL-150A — regresión de eliminación después de cancelar ruta

Diagnóstico de código: `cancelPublishedRoute` incrementa la revisión y revoca la publicación; las órdenes históricas conservan su estado. La eliminación de una incidencia de orden abierta ejecuta UPDATE de status, cuyo trigger vuelve a buscar la revisión publicada anterior y rechaza con INVALID_PRODUCT_LINE. La capa HTTP oculta ese error como 503. El flujo debe elegir sólo exclusión de reporte si la publicación de la ejecución dejó de estar vigente. No se relajan triggers ni se reconstruyen snapshots.

| Caso | Precondición / evento | Resultado y validación |
| --- | --- | --- |
| PI39 | Admin retira incidencia pendiente/resuelta tras cancelar ruta | Sólo report_removed, registro privado/fotos y cantidades intactos; PostgreSQL, HTTP, Excel y auditoría con routeRetired. |
| PI40 | Plan eliminado o publicación de revisión distinta | Misma exclusión, sin exigir presencia del plan ni de la publicación histórica; PostgreSQL. |
| PI41 | Retiro compite con cancelar ruta o cerrar pedido | Plan FOR SHARE → publicación FOR SHARE → ejecución → parada → pedido → incidencia; una lectura estable de vigencia, sin deadlock ni alteración retroactiva; concurrencia real. |
| PI42 | Confirmar, conservar, Esc y viewport estrecho | Modal con fondo/borde/radio del tema existente, foco seguro, texto de rutas canceladas y botones accesibles; E2E sobre build. |

Sin nueva migración, claves ni llamadas a Odoo/Google. Riesgo/recuperación: errores de versión mantienen el registro y permiten refrescar; replay no duplica auditoría. Referencias locales: route-publications.ts, product-incident-amendments-schema.ts, globals.css/fleet-dialog y documentación instalada Next Route Handlers/CSS. Auditoría local: GREEN LIGHT / INTEGRITY TOTAL / MATCH PERFECT con PI-T21..23; corrige la omisión del estado de ruta en BL-150, preserva BL-149 y el saldo cerrado. No se acciona borrado remoto para QA.
## BL-151 — foto de Odoo junto al nombre

Flujo: readDriverPlan agrega thumbnailPath opcional por línea → APK carga recurso privado en segundo plano → endpoint autentica sesión y vuelve a validar plan/pedido/revisión → coteja las líneas originales importadas con las publicadas → product.product/image_128 en Odoo con empresa configurada → conversión WebP 128 px → caché acotada → miniatura 40 dp. Ausencia, error o desconexión muestran Five con baja opacidad; caché privada conserva imágenes descargadas al perder señal.

| Caso | Evento / resultado | Validación |
| --- | --- | --- |
| PT01 | Foto de variante o plantilla en Odoo → foto del producto correcto | Lectura real Odoo, normalización, HTTP y APK |
| PT02 | Sin foto, archivado sin imagen o imagen inválida → logo Five atenuado | Dominio, imagen y Compose |
| PT03 | Odoo falla o no hay red → pedido utilizable; caché descargada o logo | Cache/reintento y regresión de atención |
| PT04 | Otro chofer, sesión inválida, ruta cancelada, revisión obsoleta o pedido ajeno → acceso denegado antes de caché/Odoo | PostgreSQL y HTTP reales |
| PT05 | Fuente Odoo distinta o líneas importadas ya no corresponden → nunca mostrar otra foto | Fingerprint y cotejo por índice/contenido |
| PT06 | Varias miniaturas simultáneas → consulta de lote compartida, memoria acotada y expiración automática | Concurrencia/caché/mutación |
| PT07 | APK anterior o publicación existente → compatibilidad; hashes, revisiones y acciones intactas | Comparación de snapshots y pruebas existentes |
| PT08 | Renglón con incidencia → conserva alerta, cantidad neta y acción al tocar | JVM/Compose y build APK |

Datos: sólo lecturas de publicación y route_shipments.snapshot/source; ninguna migración. Cachés auxiliares no alteran métricas ni auditoría operativa. No se exponen IDs/credenciales de Odoo ni URLs arbitrarias. Respuesta de imagen privada y sin caché compartida. Lecturas Odoo fijas, contexto de empresa y acceso de usuario existente. Imágenes normalizadas sin metadata, límites de bytes/píxeles. Caché del teléfono en cacheDir por origen/dispositivo/recurso; borrado limitado a su directorio y recuperación automática por expiración.

Referencias: documentación instalada Next Route Handlers; https://github.com/odoo/odoo/blob/19.0/addons/product/models/product_product.py (image_128 hereda plantilla); https://developer.android.com/develop/ui/compose/graphics/images/customize. Verificar capacidades reales de la instalación antes de entregar. Revertir este bloque retira recursos opcionales sin migración inversa; APK nueva tolera endpoint ausente.

Auditoría de diseño: GREEN LIGHT para implementación; se conserva BL-148..150 y el snapshot publicado (INTEGRITY TOTAL). PT-T01..03 corresponden a PT01..08 (MATCH PERFECT). Evidencia automatizada y limitaciones de validación visual en `QA-MINIATURAS-PRODUCTO-0.8.4.md`; no se certifica producción por diseño ni por compilar la APK.

## BL-152 — fallos reproducidos: recreación y foto 860 × 860

Causa demostrada en PostgreSQL aislado: DELETE de membresía elimina publicación por FK; INSERT posterior usa revisión 1 y enlaza la ejecución histórica 1. El overlay de correcciones vuelve como `point_corrected`; Android correctamente no lo trata como ruta lista para iniciar. No resolver habilitando el botón. Causa de foto demostrada contra Odoo real: `image_128` contiene WebP 860 × 860, 24536 bytes, base64 canónico; el límite anterior de 262144 píxeles lo descarta antes de reducirlo.

Diseño: migración aditiva 31 crea `route_publication_revisions(plan_id,vehicle_id,last_revision)` sin FK destructiva. Sembrar máximos desde publicaciones, ejecuciones y auditoría de publicación/cancelación; un trigger AFTER INSERT/UPDATE/DELETE retiene todo máximo futuro sin alterar publicaciones. `publishRoutes`, ya bajo FOR UPDATE del plan, calcula máximo registrado/previo + 1 y usa esa revisión en INSERT/UPSERT. No cambiar cancelación/inicio ni datos históricos. Normalizador acepta hasta 4096² píxeles (64 MiB RGBA nominales), muy por debajo del límite general de Sharp; entrada base64 sigue 180000 caracteres y salida WebP 128 px/65536 bytes sin metadata.

| Caso | Evento / resultado | Datos, seguridad y validación |
| --- | --- | --- |
| RF01 | Cancelar iniciada, quitar/agregar, publicar/iniciar | Revisión nueva, ejecución nueva, sin correcciones/entregas/incidencias viejas; PG real, historial intacto |
| RF02 | Quitar/agregar sin iniciar, repetir varias veces | Nunca repetir revisión ni identidad de caché/push; PG y auditoría |
| RF03 | Publicación repetida / concurrente | Mantener idempotencia y exclusión por plan; no consumir revisión sin cambio |
| RF04 | Migrar/repetir migración con rutas activas y retiradas | Sólo registro técnico; snapshots, started_at, fotos e historial sin cambios; PG |
| RF05 | Token ajeno, revisión vieja, menos de 5 fotos o fecha incorrecta | Mismos rechazos; regresión start/publicación y HTTP |
| RF06 | Fallo dentro de transacción | Registro y publicación revierten juntos; PG |
| RF07 | Foto 860/1920, exacto límite, entrada excesiva o inválida | Reducir válidas, fallback en rechazadas; bytes reales, Odoo real y mutación |
| RF08 | Despliegue sin APK nueva | Contrato móvil intacto; caché de ausencia anterior expira en hasta 15 min; HTTP sobre build |

Auditoría local: GREEN LIGHT / INTEGRITY TOTAL / MATCH PERFECT para RF-T01..03. Sin delegar decisiones de identidad/concurrencia. Referencias: FK y triggers locales, docs instaladas Next Route Handlers y constructor Sharp. Migración no modifica ruta activa ni históricos; downgrade a servidor schema30 no soportado (requiere servidor compatible con31), por lo que no ejecutar migración remota desde esta tarea. Deploy manual del propietario.

Ejecución y revisión independiente terminadas: evidencia RF01..08 en `QA-RECREACION-RUTA-Y-FOTO-ODOO.md`. Incluye PostgreSQL real, Odoo en lectura, HTTP, cobertura y 15 mutaciones detectadas. Se conserva explícitamente el timeout de limpieza de la suite general y su repetición aprobada; no se oculta como una suite verde en un solo intento. Sin cambios en Android ni reglas de inicio/atención. Commit/push a develop autorizados expresamente por el propietario el 2026-09-29; deploy no realizado.
## BL-153 — iconos de métricas de ruta

`DriverRouteScreen.RouteMetric` recibe `iconTint` explícito desde sus cuatro llamadas. Reutilizar `DriverColors.blue/red/lime/amber` y los vectores actuales (fill=null, stroke=1.7). Sin cambios de datos, API ni permisos. APK 0.8.5/code27 para instalar sobre la anterior. Aceptación: cada icono conserva contorno/tamaño y muestra el color solicitado; etiquetas y valores permanecen iguales. Verificar build/lint y regresión JVM existentes; QA visual en el dispositivo del propietario.

## BL-154 — destino auxiliar bodega

BL-155 sustituye únicamente la exclusión de `rescheduled` de WB02 por su tratamiento como terminal no entregado y añade cierre operativo. Los restantes escenarios WB siguen vigentes.

`readDriverPlan`, después de autorizar asignación/publicación, añade `departure` opcional con dirección, coordenadas y versión de la configuración global real. Overlay sin reescribir snapshots, hashes o revisiones; compatible con publicaciones iniciadas y APK anteriores. Android tolera servidor anterior (campo ausente) y origen inválido. Política pura coteja todos los IDs/estados de pedidos con plan/ejecución antes de crear un destino auxiliar tipado. UI reutiliza el aviso de continuación y navegación de destino único; retorno sólo por acción explícita, sin SDK simulator. Destino auxiliar no pertenece a `execution.stops`, no participa en entrega/llegada/corrección, y tracking nunca transmite su identidad como stopId. Restauración reconoce la guía por ejecución, versión y coordenadas del origen; cálculo tardío, origen cambiado, ruta retirada o pedido reabierto invalidan la guía de regreso.

| Caso | Resultado / evidencia requerida |
| --- | --- |
| WB01 | Última entrega confirmada, todos entregados → aviso y acción explícita a origen real |
| WB02 | Abierto/cerrado pendiente/rechazado/reprogramado, incluso sin GPS o en parada actual → no regreso |
| WB03 | Plan/revisión/IDs incompletos o duplicados, origen ausente/inválido, servidor anterior → no inventar destino |
| WB04 | Cerrar aviso/reabrir mapa/rotar → botón recuperable, sin auto-navegar ni duplicar entrega |
| WB05 | Sin confirmación/red/SDK listo o comando pendiente → acción bloqueada; recuperación sin nueva entrega |
| WB06 | Origen actualizado, revocación o reapertura durante cálculo/guía → invalidación; callback viejo no reinicia |
| WB07 | Regreso → guía SDK real, tracking stopId nulo; entrega, orden, métricas e historial intactos |
| WB08 | Otro chofer/ruta cancelada → mismo rechazo antes de exponer origen; PG y contrato reales |

WB-T01 contrato PG/lectura; WB-T02 política y navegación; WB-T03 QA, cobertura, mutación, instrumentación y APK. Sin migración ni dependencia nueva; rollback retira campos/acciones auxiliares. Referencia SDK: https://developers.google.com/maps/documentation/navigation/android-sdk/route y Navigator; documentos Next instalados Route Handlers. QA físico SDK/GPS condicionado a dispositivo real autorizado, nunca simulado.

## BL-155 — finalizar recorrido, sin liquidación

Primero servidor: migración aditiva 32 agrega registro de finalización inmutable por ejecución. Endpoint móvil POST finish usa permisos existentes, origen global y política GPS reales, locks de plan/publicación/ejecución y recibos por dispositivo/comando. No crear parada bodega ni reescribir snapshot. Exponer completedAt en lecturas autorizadas; impedir nuevas escrituras móviles/tracking de ejecución terminada, conservando consultas/recibos. Después Android: cola cifrada de comando de ruta, GPS validado en UI, modal de confirmación y relectura; retirar acceso a mapa vivo después de cierre confirmado y mostrar estado terminado en historial. Ampliar elegibilidad de regreso a delivered/rescheduled sin ocultar la diferencia. Reprogramación remota permite sólo closed_pending con caso customer_closed real; versión y visita coinciden, nunca entrega remota.

| Caso | Resultado / validación |
| --- | --- |
| WF01 | Entregados/reprogramados + GPS bodega válido + Aceptar → un cierre operativo, tracking detenido y datos conservados |
| WF02 | Cancelar / lejos / GPS viejo, impreciso o simulado / origen ausente o cambiado → sin cierre |
| WF03 | Pedido pendiente o IDs incompletos / revisión vieja / otra sesión, ejecución o chofer → rechazo atómico |
| WF04 | Doble tap, solicitudes concurrentes, respuesta perdida, app reiniciada → un cierre/recibo recuperable |
| WF05 | Tras cierre → no entregar, corregir, reabrir reprogramado, reportar o reiniciar tracking; consultas/admin reporte intactos |
| WF06 | Reprogramar closed_pending tras abandonar visita, a distancia → rescheduled con caso real e historial; entrega remota bloqueada |
| WF07 | Carrera reprogramar/reabrir/cancelar/cerrar, error transaccional → estados consistentes, rollback, versión/conflicto recuperable |
| WF08 | Upgrade repetido / APK antigua / plan retirado → datos históricos conservados; servidor anterior no confirma cierre inexistente |

WF-T01 esquema/servidor/contratos; WF-T02 Android y consumidores; WF-T03 pruebas PG/HTTP/unitarias, cobertura/mutación, build y QA físico. Cierre no equivale a liquidación, no asigna fecha a reprogramados y no activa disponibilidad de flota por sí solo. Riesgo alto de transición de estado: todas las rutas críticas requieren validación, sin sustituir pruebas de GPS real por simulador.

## BL-156 — contrato auxiliar bodega en Ruta en vivo

Causa verificada: guía bodega usa stopId nulo, LiveTrackingService sólo consulta ETA por ese stopId y el panel sólo entiende paradas. No reemplazar textos a partir del contador de entregas. Primero migración aditiva33 agrega warehouse_depot_version nullable a route_live_tracking con CHECK positivo y target_stop_id nulo; no backfill ni nuevas tablas de negocio. Telemetría opcional destination={kind:warehouse,depotVersion}; ETA bodega con targetStopId nulo y depotVersion coincidente, sin UUID artificial. begin/stop/destino cliente/cierre limpian metadato. Bajo locks existentes de publicación/ejecución/tracking, revalidar configuración compartida y todos los IDs/estados publicados mediante la política de cierre ya existente; no modifica su implementación. Lectura administrativa vuelve a validar origen/pedidos y no expone un regreso inválido. Etiquetas compartidas usan timestamp de heartbeat; GPS/ETA conservan sus controles de edad. Sin red envejece a «Regreso a bodega · sin confirmación reciente», nunca sigue afirmando un regreso confirmado. Parada cliente, atención y finalización conservan prioridad.

| Caso | Actor/precondición/evento → resultado | Datos/validación/fallo |
| --- | --- | --- |
| WD01 | Chofer con todos entregados/reprogramados inicia guía bodega → señal y ETA al panel | PG/HTTP/Android; destino real, stopId nulo, contador intacto |
| WD02 | Pedidos terminados pero guía no iniciada / APK vieja → sin regreso inventado | Contrato opcional, UI |
| WD03 | Origen ausente/versión vieja, pendientes, IDs extra/faltantes → señal rechazada | PG/política; rollback de secuencia/GPS, publicación conservada |
| WD04 | StopId cliente + bodega o ETA ajena/malformada → rechazo | Entrada estricta, CHECK real, unitarias/contrato |
| WD05 | Cambiar origen o reabrir reprogramado → lectura invalida, siguiente muestra rechaza | Locks existentes serializan; PG concurrencia |
| WD06 | Detener guía/seguimiento, nueva sesión, cambiar cliente o finalizar → retirar señal/ETA | PG/Android; cierre inmutable32 sin cambio |
| WD07 | Red/GPS viejo/falta SDK/callback anterior → no ETA ni confirmación fresca inventadas | Unitarias; ausencia real GPS no se simula |
| WD08 | Otro dispositivo/chofer, sesión revocada/ruta cancelada → mismo aislamiento | PG/HTTP y regresión existente |
| WD09 | Refresh, fechas/choferes, avance/resumen/tiempos en móvil/desktop → texto coherente | E2E real; tema existente sin rediseño |
| WD10 | Upgrade32→33/repetición/versiones antiguas → preservar GPS, recibos y cierre | PG migración; compatibilidad backward APK, backend previo no certifica destino |

WD-T01 servidor/esquema/política; WD-T02 Android y tres presentaciones; WD-T03 QA y evidencia. Auditoría local de arquitectura: GREEN LIGHT / INTEGRITY TOTAL / MATCH PERFECT. Referencias: archivos reales live-tracking/live-routes/NavigationRegistry, documentos Next instalados Route Handlers y Server/Client Components, contrato Navigator ya integrado. No nueva llamada a Google/Odoo, secreto o dependencia. Rollback de app tolera metadatos ausentes; tras schema33 requiere backend compatible con33. No delegación de invariantes ni inicio de liquidaciones.

## BL-157..159 — especificación bloque 1 financiero aprobado

F-T01: contrato cerrado readFinancialSources en odoo.ts. Inspección de campos; caché de capacidades por origen/credencial con caducidad. Lectura secuencial de picking, orden, todas sus líneas comerciales, movimientos relacionados y moneda; segunda lectura completa y comparación canónica para detectar cambios, sin depender sólo de write_date de resolución de un segundo. No expone un ejecutor genérico. Nuevos imports conservan saleLineId/uomId opcionales para compatibilidad. Dinero serializado como strings decimales; decimal.js fijado, sin cálculo de impuestos local ni búsqueda por producto/nombre.

F-T02: migración34 aditiva route_financial_targets, route_financial_revisions y route_financial_sync_state. Trigger AFTER INSERT de route_shipments y backfill crean una sola identidad por origen/picking/orden, independientemente de cuántos planes lo importen. Historial sin cascada a planes/publicaciones. Revisión inmutable con hash canónico; puntero actual sólo avanza cuando cambia el contenido. Una nueva revisión puede volver un origen no cobrable. No reescribir snapshot operativo ni recibos. Migración repetible desde33; rollback de app requiere compatibilidad34.

F-T03: worker automático con configuración runtime de intervalo/lote/backoff, exclusión PostgreSQL por sesión/origen; el mismo cliente que retiene el lock persiste y libera. Ninguna transacción abierta durante RPC. Trabajo sólo de planes no archivados; historial retenido. Errores y enfriamiento global persistentes; Retry-After respetado, sin registrar credenciales/respuestas externas. Instalación/origen verificados antes de consultar. Métricas persistidas de intentos, errores, duración, éxito y edad. Tras perder conexión se libera lock y no se admite commit del cliente anterior.

F-T04: lectura financiera reutilizable en servidor para administrador activo por shipment; consulta privada de historial por IDs internos. Sin endpoint nuevo ni UI en bloque1; autorización móvil se incorporará junto al consumidor y su versión en bloque2. Estado pending_validation/ready/needs_review/cancelled; motivos, identidad, importes oficiales, diferencias, versión, fecha/error. Totales de venta diferenciados de totales de entrega (nullable); parcial/UOM distinta o cobertura incompleta nunca adquiere total completo. En impuestos se conservan importes Odoo y sólo se acepta conciliación exacta; demostración de redondeo global en ausencia de impuestos y con cálculo de descuento verificado.

F-T05: unidades y contratos, Gherkin LQ01..14, PG real (upgrade, inmutabilidad, idempotencia, exclusión, caída, errores, autorización), contrato Odoo real de lectura por IDs; regresión publicación/inicio/incidencias. Cobertura dirigida >=95% líneas/ramas objetivo, mutación >=90% objetivo y revisión individual de supervivientes; calidad/latencia y limitaciones medidas. No certificar mutaciones externas o transiciones Odoo que no se ejecutaron. QA físico no aplica: sin cambios Android/UI.

Correspondencia: F-T01 LQ01..08,12,13; F-T02 LQ01,05,10,11,14; F-T03 LQ02..04,09,10,12,13; F-T04 LQ01,07,09,13; F-T05 todos. Alcance separado y dependencias en BLOQUE-LIQUIDACION-RUTAS-2026-09-30.md. Decisiones de arquitectura y revisión final permanecen en Codex.

Revisión F-T03: un objetivo con fallos se reintenta solo, aun después del éxito de otro; un lote sano excluye los objetivos fallidos. Evita que un registro defectuoso bloquee repetidamente las demás identidades. PG real y dos mutaciones específicas validan ambas selecciones. `ready` certifica conciliación de la observación, no autorización de cobro ni frescura ilimitada; el consumidor de confirmación futura debe validar edad/error/versión. Evidencia y límites en QA-FUENTE-FINANCIERA-BLOQUE-1.md.

Dependencias de cierre: decimal.js10.6.0 y parches de seguridad compatibles; Next/eslint-config-next16.3.8, brace-expansion y fast-uri. El build y los E2E financieros/móviles se repitieron sobre el árbol actualizado. Sin despliegue ni cambios Android.

## Bloque 2 aprobado — PF, proyección e incidencias financieras

Base develop362c948; schema34 y APK0.8.7/code29 inspeccionados antes de editar. Plan aprobado mediante «dale al bloque 2 y probamos completa». Referencias: guías Next instaladas Route Handlers; [Compose state](https://developer.android.com/develop/ui/compose/state) y [semantics](https://developer.android.com/develop/ui/compose/accessibility/semantics); contratos y triggers reales de producto27/29/30, ejecución, miniaturas y worker34. Master Architect y UI/UX aplicados sin sustituir el tema existente por la recomendación genérica de landing del buscador.

### Conexión auditada y solución

Publicación elimina IDs de partida y se mantiene inmutable después de iniciar; import snapshot retiene moveId/productId. El trigger de incidencias valida source_quantity contra publicación, y Android usa Double/cantidad publicada en dos fichas. Agregar sólo precios a UI dejaría límites antiguos y resúmenes desincronizados. `driverPublicationFingerprint` tampoco considera finanzas ni revisa huella durante un heartbeat sin notificación.

PF-T01: módulos de contrato/política de proyección y reparto decimal. Conservar `order.lines` operativo para APK anterior/miniaturas; añadir `order.financial` con contractVersion, revision, status, freshness/error/checkedAt, líneas por lineIndex + moveId/saleLineId/UOM, cantidades decimales, unitPrice/descuento/importes originales, cantidad física restante y desglose monetario. Correspondencia completa entre publicación e import congelado antes de usar sus IDs, como exige miniaturas; enlazar luego sólo por moveId. No buscar por nombre. IDs o cobertura cambiados → revisión explícita, sin total derivado.

Reparto: asignar cada importe oficial de línea comercial entre sus movimientos por cantidad; después entre importe conservado, devolución/faltante y reposición diferida por cantidades. Usar unidades enteras de redondeo, mayor residuo y desempate determinista por orden/ID; ajuste global se reparte con las mismas categorías y se muestra aparte. Cantidad cero tiene peso cero; devolución total termina exactamente en cero; pago completo conserva importe aunque reduzca cantidad física. No calcular porcentajes de impuestos ni cambiar Odoo.

PF-T02: migración35 aditiva añade a incidencias financial_revision, financial_move_id, financial_sale_line_id y replacement_payment. Validación SQL comprueba revisión almacenada, identity de shipment/import/publicación/movimiento/línea, cantidad real y sumatoria bajo lock de execution_order. Nueva vía financiera convive con vía histórica de cantidad publicada. Permitir faltante ligado sólo con referencia financiera válida; faltante manual mantiene line_index/source_quantity nulos y no obtiene precio. Preservar constraints/fotos/cancelación/inmutabilidad/versionado/auditoría. Ampliar únicamente campos financieros y source_quantity modificables mediante comando versionado; line_index e identidad operacional no se mueven. Cancelar/resolver mantiene el tratamiento operativo, sin revalidar una fuente externa ya retirada.

PF-T03: servicio de lectura interno bajo autorización existente de `readDriverPlan`, consulta por lote de shipments de la publicación. Para comandos usar mismo Sql y locks de ciclo/ejecución/orden, después target financiero FOR SHARE; worker34 sólo bloquea target, sin ciclo inverso. Comparar revision esperada, estado, última consulta/error y frescura runtime antes de escribir. Incidencias nuevas incluyen campos nuevos en hash idempotente; peticiones antiguas sin esos campos mantienen su hash exacto. Un cambio posterior de base monetaria (cantidad, precio, descuento, importe, moneda/UOM) invalida valorización anterior, sin alterar su registro.

Lectura incluye incidencias de la ejecución exacta; no mezcla publicaciones viejas, resolved sigue vigente y report_removed no cancela dinero. Proyección previa al inicio no inventa ejecución. Contextos sin finanzas siguen usando operación anterior; incidencias antiguas sin evidencia monetaria quedan explícitamente sin valorización. Frescura configurable mediante RUTAS_FINANCIAL_FRESH_SECONDS, default tres intervalos de polling; es guardia operativa, no promesa/SLO. Expone latest-error/edad, sin secretos ni SQL al cliente.

PF-T04: fingerprint autorizado incorpora revisión/salud financiera de sus shipments. Heartbeat comprueba huella aun sin NOTIFY, para detectar envejecimiento/error. Triggers específicos avisan cambios significativos del target; no reescriben publicaciones. Android recibe cambios en ambos modelos; detalle seleccionado de otro día se relee por su ID. Carga ejecución/plan debe detectar revisión operacional mezclada. La hoja financiera recibe estado actual, no copia retenida con remember.

PF-T05: UI existente oscura/lima, filas con nombre/miniatura, cantidad y un segundo nivel de precio unitario/total; resumen separado original, descuentos, reposición pendiente, ajuste y monto actual. No mezclar monto físico y pendiente financiero. Reposición pregunta explícitamente sin preselección; faltante permite elegir partida incluida o producto ajeno. Cantidades/precios BigDecimal sólo para presentación/entrada, resultados monetarios autoritativos del servidor. Mantener cámara, cola cifrada, accesibilidad, giro de pantalla, borradores, confirmación y botones operativos. Versionar APK0.8.8/code30 sólo al construir con contrato35 compatible.

### Escenarios y puertas

| Caso | Actor/precondición/evento → resultado             | Datos/efecto y validación                                                     |
| ---- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| PF01 | Pendiente → done durante ruta/ficha abierta       | Valores finales automáticos; publicación intacta; Odoo lectura, PG/HTTP/JVM   |
| PF02 | Validados/reordenados/productos iguales           | Asociación estable, import/publicación completos; rechazo si falta identidad  |
| PF03 | Varios movimientos por venta y ajuste de centavos | Reparto exacto, sin duplicar total; propiedad conservación/unitarias/mutación |
| PF04 | Devolución/faltante ligado parcial o total        | Descuento por partida y orden; total completo devuelto=0                      |
| PF05 | Reposición paga completo vs diferido              | Elección obligatoria, cantidad física separada; pendiente sólo defer          |
| PF06 | Producto manual ausente                           | Registro sin precio inventado/descuento; no asociación por texto              |
| PF07 | Cantidad nueva 5.12 sobre publicación5            | App/servidor/SQL mismo límite; suma concurrente nunca excede5.12              |
| PF08 | Editar/cancelar/resolver/retirar del reporte      | Auditoría/recibo; sólo cancelación revierte dinero; no alterar terminales     |
| PF09 | Fuente cambia mientras se captura/guarda          | Esperada vieja rechazada; borrador conservado/revisión explícita              |
| PF10 | Fuente cambia tras guardar incidencia             | Base equivalente conserva valoración; distinta requiere revisión              |
| PF11 | Odoo falla/429/antiguo/offline                    | Aviso, último dato identificado, nuevas confirmaciones financieras bloqueadas |
| PF12 | Doble tap/respuesta perdida/reinicio              | Recibo único, cola recuperable; sin descuento duplicado                       |
| PF13 | Otra sesión/chofer/ruta/empresa                   | Rechazo antes de finanzas; permisos/aislamiento PG/HTTP                       |
| PF14 | Incidencias/publicaciones/APK históricas          | Operación anterior preservada; sin asignar elección/precio supuestos          |
| PF15 | Migración34→35 repetida/carrera/rollback          | Conservar filas/recibos/triggers; transacción completa                        |
| PF16 | SSE/heartbeat/otra fecha/ficha abierta            | Releer identidad correcta; envejecimiento detectado sin intervención          |
| PF17 | Nombres largos/tamaño fuente/giro/cámara          | Filas legibles, controles accesibles, borrador estable, Compose               |
| PF18 | Impuestos/descuentos/monedas/ajuste negativo      | Conservar importes oficiales y precisión; cero simulación fiscal              |

PF-T06: tests de dominio y contratos afectados, Gherkin, PG real (migración/CHECK/locks/rollback/permisos), HTTP sobre Next real, proveedor Odoo de sólo lectura cuando disponible, JVM/Compose y APK; cobertura dirigida objetivo>=95%, mutación>=90% con revisión de supervivientes; invariantes de importe/identidad/autorización sin rutas críticas sin probar. Reportar omisiones físicas honestamente; no simular un proveedor ni GPS. Repetir regresión general una vez estabilizado el código. Metricar complejidad, latencia y errores; audit dependencias y secretos.

Auditoría de diseño: GREEN LIGHT para construir; INTEGRITY TOTAL con BL157..161 y guardas operativas; MATCH PERFECT PF-T01..06/escenariosPF01..18. No habilita cobro, rol liquidador ni recepción. Despliegue manual del propietario, main/Five intactos; rollback tras35 requiere servidor compatible35 y APK anterior tolerada. Sin subdelegación de reglas monetarias, seguridad o concurrencia.

## BL-162..168 — especificación integrada
Contrato, esquema36..38, flujos, permisos, fallos/recuperación y matriz CF01..16 en BLOQUES-LIQUIDACION-3-6.md. Correspondencia CF-T01..06 en PROGRESS. Plan completo autorizado. Autopsia comprobó que cierre operativo prohíbe comandos de visita; operaciones financieras históricas usan autorización propia sin reabrir ejecución. Revisiones de importes y solicitudes confirmadas se conservan inmutables.

## BL-169 — ajuste Android solicitado tras QA del propietario

Autopsia: PaymentCapture usa FilterChip estrechos y comparte «Cantidad recibida» entre cash/transfer. Su variable change permite introducir cambio, aunque el propietario solicita capturar sólo dinero neto. Contrato actual es un medio por recibo; transferencia no representa pago combinado. Campo vacío falla la política decimal y bloquea Confirmar; fuente ausente también bloquea.

Flujo: PaymentMethodPicker de ancho completo, mínimo88dp, emoji decorativo solicitado, texto, radio y acentos lima/azul/morado del tema. Radio accesible exclusivo y estado deshabilitado durante busy/pending. PaymentReceivedField identifica efectivo/transferencia y explica crédito sin ingreso. paymentCapturePreview reutiliza la política vigente con cambio cero; JSON se forma con importes validados, conservando basis, nota, ID de comando y outbox. Se elimina únicamente el estado/entrada de cambio nuevo; esquema38, endpoints y recibos históricos conservan compatibilidad.

| Caso | Evento y resultado | Validación |
|---|---|---|
| PC01 | Seleccionar cada tarjeta cambia un único medio; busy/pending no permite cambiarlo | Compose real; semántica radio |
| PC02 | Efectivo neto parcial/completo/cero explícito produce saldo exacto y cambio cero | JVM/contrato/mutación |
| PC03 | Transferencia vacía, inválida, excesiva o sin fuente no confirma; valor válido no se suma a efectivo | JVM/PG existente/Compose |
| PC04 | Crédito no pide importe y conserva deuda completa sin dinero recibido | JVM/Compose |
| PC05 | Letra grande/320dp mantiene texto y tarjetas legibles, sin altura fija ni truncamiento | Compose compilado y QA física del propietario |
| PC06 | Historial con cambio anterior, reintentos, precisión, fuente actualizada y permisos intactos | Regresión JVM y contrato PG existentes |

Referencias: DriverDesign.kt e IncidentFormDesign.kt reales; [Compose: controles accesibles](https://developer.android.com/develop/ui/compose/accessibility/api-defaults). Consulta UI/UX y patrones21st revisados; se conserva el sistema existente y se usan emojis por petición explícita. Sin dependencias, backend, migraciones ni costes externos nuevos. GREEN LIGHT, INTEGRITY TOTAL y MATCH PERFECT con PC-T01..03. Rollback APK compatible con esquema38; excepción de ejecución física vigente, sin inventar evidencia visual.

## BL-170 — autopsia de sugerencia de correo en cuentas
Inspección: dashboard usa input de texto implícito y autocomplete off para name/login, sin ID diferenciado entre formularios. auth.loginKey normaliza texto, sin condición email. El aviso de las capturas coincide con Email Aliases de Brave; su código AddEmailAliasSuggestsion ofrece alias cuando clasifica signup+username incluso si no es input email. Identificar nombre/usuario evita ambigüedad semántica, pero no promete suprimir ese comportamiento nativo en el usuario.

Corrección: type=text/inputMode=text, IDs por rol, label htmlFor, autocomplete section-routes/section-settlement con name/username/new-password. Usuario sin autocapitalización/corrector y ayuda asociada «Usuario interno; no requiere correo electrónico». No cambiar name/login enviados al API ni restricciones/hashing/auditoría. Forms con aria-label distinto y password perteneciente a su sección. Sin librerías, RPC o migraciones nuevas.

| Caso | Resultado obligatorio | Evidencia |
|---|---|---|
| AC01 | Nombre Unicode y usuario con espacios sin @ válidos en formulario routes | DOM, alta real HTTP/PG, consulta y login |
| AC02 | Mismo flujo settlement no afecta borrador ni rol de otro formulario | E2E real y aislamiento de formularios |
| AC03 | Cada label apunta a ID único y semántica correcta; vacío/longitud mínima siguen rechazados | Validación HTML real y atributos |
| AC04 | Liquidador creado entra sólo en liquidación, rutas sólo operativa | HTTP real con cookies independientes |
| AC05 | Popup propio de Brave no tratado como validación del servidor | Código oficial Brave; límite documentado, no simular popup |

Referencias: guía Next instalada forms/RouteHandlers; [autocomplete](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete); [Brave AddEmailAliasSuggestsion](https://github.com/brave/brave-core/blob/master/chromium_src/chrome/browser/ui/autofill/chrome_autofill_client.cc); [Email Aliases](https://brave.com/privacy-updates/39-email-aliases/). GREEN LIGHT, INTEGRITY TOTAL, MATCH PERFECT con AC-T01..02. Cambio de marcado sin lógica crítica nueva: mutación monetaria/auth no aplicable; se conserva evidencia previa y repiten contratos de cuenta mediante E2E real.

## BL-171..174 — corrección del flujo por pedido

Autopsia, datos/locks/contratos, permisos, matriz CP01..14, migración aditiva,
compatibilidad y puertas en CORRECCION-ODOO-COBRO-POR-PEDIDO.md. Sustituye
explícitamente el orden y exclusiones anteriores de BL162..169. GREEN LIGHT,
INTEGRITY TOTAL y MATCH PERFECT con CP-T01..05; implementación por bloques.

## BL-175..178 — presentación y sincronización verificable

Plan aprobado, autopsia, datos, proyección de descuentos, accesibilidad y
escenarios LC01..12 en PROPUESTA-LIQUIDACION-CLARA-2026-10-01.md. No filtrar
el contrato operativo usado antes del cobro ni alterar bases/hashes históricos.
