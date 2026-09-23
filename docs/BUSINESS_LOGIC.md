# Ana Rutas — bloque 1 aprobado

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
