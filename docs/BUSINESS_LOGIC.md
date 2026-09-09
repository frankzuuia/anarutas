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

Bloque 2A autorizado: BL-007..010 (camionetas, choferes, asignación actual y documentos privados), especificado en BLOQUE-2-FLOTA.md. Clientes/ventanas siguen pendientes.

2. Unidades, choferes y documentos privados; clientes, direcciones, coordenadas, ventanas y prioridades.
3. Importación idempotente de surtidos validados y selección de unidades: BL-011..014 en BLOQUE-3-PEDIDOS.md. Calendario operativo completo posterior.
4. Google Maps/optimización, arrastre y recálculo de rutas afectadas, conflictos de ventanas, publicación versionada.
5. Asistente flotante con herramientas nativas; mismos servicios de dominio que botones, trabajos durables y recuperación.
6. APK Android, GPS, incidencias, llegadas y corrección de punto; liquidaciones y reportes según procesos autorizados.

## Decisiones pendientes que no se inventan

- Captura acordada: una sola fecha de validación de pedidos, inicializada con el día civil actual de la instalación y editable hasta la fecha del plan. La carga manual por folio puede recuperar surtidos validados fuera de esa fecha; corte, días laborables/feriados todavía pendientes.
- Depósito y horario de salida; política exacta de prioridad alta frente a ventanas incompatibles.
- Proyecto/clave Google habilitados; cuenta/modelo del agente y permisos de integración.
- Procedimiento real de devoluciones/contabilidad: no hay autorización de escrituras Odoo para ese alcance.
