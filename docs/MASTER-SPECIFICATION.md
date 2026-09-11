# Bloque 1 — especificación y auditoría previa

Extensión 5B: BL-032..036 y R01..14 en BLOQUE-5B-RECALCULO-IA.md sustituyen
la obsolescencia manual S39 por recálculo automático conservando el orden, y la salida
libre por horario configurado por plan. OpenAI fue seleccionado por el usuario;
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

### S27: cargas independientes (BL-005, BL-013, BL-015)

El modal no contiene una acción separada para guardar camionetas. «Cargar pedidos»
guarda la selección diaria y ejecuta únicamente la importación por fecha. «Confirmar
pedidos» llama únicamente a la carga manual por folios: no guarda camionetas ni
ejecuta la consulta por fecha. Cada acción conserva su propio indicador visual de
progreso; las demás se deshabilitan por exclusión mutua sin mostrar una operación
que no están ejecutando.

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

Build/types/lint; auditoría npm; unidades para configuración/seguridad; integración con servidor PostgreSQL real local desechable; E2E login/setup/borrador/acceso; Gherkin; mutation testing para predicados críticos. Objetivo por riesgo: 100% de predicados de autorización/origin/expiración y al menos 85% líneas en core; no declarar verde por promedio si falta escenario crítico. Registrar latencias y errores reales sin afirmar SLO de producción desde localhost. No commit/push/deploy hasta evidencia o excepción aprobada.

## Veredicto previo

GREEN LIGHT: construcción del bloque 1 local autorizada, con interfaces que no mezclan dominios. MATCH PERFECT: BL-001..006 y S01..17 tienen tareas en PROGRESS. Esto NO certifica el software aún no construido ni habilita producción. Integración Odoo live, imagen Docker en Linux, backup/restauración y configuración de servidores requieren validación antes de despliegue.

## Batch 5: BL-026 a BL-030 — optimización vial

### Requirements Covered

Salida única confirmada; optimización sin peso/capacidad; ventanas duras; precedencia
Alta→Media→Por horario; tráfico, asignación, orden, ETA, distancia, polilínea y tokens
por transición; aplicación versionada y resultado obsoleto tras edición manual.

### Scenario Matrix

| ID  | Actor / precondición                     | Disparador          | Lectura/escritura      | Resultado                                      | Fallo y recuperación                          |
| --- | ---------------------------------------- | ------------------- | ---------------------- | ---------------------------------------------- | --------------------------------------------- |
| S32 | Admin, Maps activo, salida sin confirmar | Abre configuración  | Runtime + settings     | Dirección sugerida, ningún punto inventado     | Puede cerrar sin escritura                    |
| S33 | Admin con salida vigente                 | Confirma otro punto | Settings/auditoría     | Versión y liga regeneradas                     | 409 conserva edición ajena                    |
| S34 | Plan con flota/pedidos/puntos            | Armar ruta          | OpenAI tools→Google→DB | Mejor candidato factible aplicado atómicamente | Servicio externo falla: cero cambio           |
| S35 | Ventanas/prioridades mezcladas           | Resolver modelo     | Route Optimization     | Ventanas duras y precedencia por nivel         | Incompatibilidad visible, no relajada         |
| S36 | Otro admin cambia el plan durante Google | Aplicar respuesta   | Lock/version           | 409; resultado no aplicado                     | Actualizar y decidir de nuevo                 |
| S37 | Google omite un pedido                   | Aplicar solución    | Runs/stops/shipments   | Pedido Sin asignar con razón                   | Corregir punto/ventana y reintentar           |
| S38 | Ruta vigente                             | Ver mapa            | Run vigente            | Recorrido, ETA, km y duración reales           | Sin run vigente muestra puntos, no ruta falsa |
| S39 | Ruta vigente                             | Movimiento manual   | Plan/job/version       | Conserva acomodo y recalcula calles/ETA        | Reintento durable sin redistribución          |
| S40 | Origen incompleto o ambiguo              | Ubicar domicilio    | Google Geocoder        | Referencia visible; confirmar bloqueado        | Completar dirección o marcar punto exacto     |

### Data Flow

El servidor obtiene configuración y snapshot desde PostgreSQL. OpenAI sólo recibe
identidades opacas, coordenadas, ventanas y prioridades mediante tools nativas; Google
mide los candidatos por vialidad real. El servidor valida cobertura, orden, prioridad,
ventanas y versión, y sólo entonces aplica. El navegador recibe un contrato sanitizado;
los route tokens permanecen privados para el endpoint de conductor futuro.

### Tables / APIs / Tools

Migración v7 y contratos definidos en `BLOQUE-5B-RECALCULO-IA.md`. OpenAI orquesta la
distribución, Route Optimization aporta una propuesta base y Routes API evalúa y
recalcula cada tramo, incluido el regreso a bodega.

### Permissions / Tenant Boundaries

Cuenta de servicio exclusiva por instalación con `roles/routeoptimization.editor`.
Proyecto, JSON y claves sólo en EasyPanel. Una instalación no acepta un `project_id`
distinto al configurado.

### Integrations / Costs / Limits

Timeout dinámico por tamaño; AbortSignal local; tamaño de respuesta acotado; métricas de
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
