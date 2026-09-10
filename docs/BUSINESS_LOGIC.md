# Ana Rutas — bloque 1 aprobado

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
- El horario laboral específico y una posible hora de regreso siguen pendientes; el
  bloque 5 usa el día civil completo y únicamente punto de salida.
- Procedimiento real de devoluciones/contabilidad: no hay autorización de escrituras Odoo para ese alcance.

## Extensión aprobada — optimización Google

| Regla             | Actor / negocio                                                              | Dirección técnica / datos                                                                            | Permiso y auditoría                                         | Validación                                                                |
| ----------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| BL-026 Salida     | Administrador configura el origen de todas las rutas                         | Dirección editable y coordenada confirmada; sugerencia runtime; sólo inicio, sin regreso             | Sesión activa, versión y `routing.settings.updated`         | Dirección sin punto bloquea optimización; rango geográfico estricto       |
| BL-027 Modelo     | Administrador arma el plan con datos reales, sin peso                        | Camionetas del plan, coordenadas confirmadas, ventanas, prioridad y día civil local                  | Modelo construido sólo en servidor; Google OAuth privado    | Sin flota/pedidos/puntos no llama Google; ninguna capacidad inventada     |
| BL-028 Prioridad  | Alta debe ocurrir antes que Media y Por horario; Media antes que Por horario | Reglas de precedencia de entregas además de ventanas duras                                           | Política única auditable, no elegida por el navegador       | Conflicto se informa; no se relaja silenciosamente                        |
| BL-029 Aplicación | Propuesta Google asigna y ordena pedidos                                     | Snapshot por versión, llamada externa y aplicación transaccional; métricas/ETA/polilínea persistidas | `plan.optimized`; actor y solicitud lógica                  | Cambio concurrente devuelve 409; reintento no duplica                     |
| BL-030 Navegación | Web muestra recorridos reales y APK futura podrá navegar cada tramo          | Polilíneas visibles; route tokens privados por transición                                            | Sólo endpoints autenticados; tokens no salen en tablero web | Movimiento manual marca resultado obsoleto; nunca se muestra como vigente |
| BL-031 Precisión  | El origen debe representar un domicilio real, no la primera coincidencia     | Geocodificación restringida al país; acepta domicilio preciso o ajuste manual explícito              | Misma sesión y guardado versionado de BL-026                | Parcial/aproximada sólo centra el mapa; edición limpia la propuesta       |
