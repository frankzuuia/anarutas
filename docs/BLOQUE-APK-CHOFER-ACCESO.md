# Bloque móvil 1 — identidad del chofer y lectura de su ruta

Autorizado el 21/09/2026. El proyecto Android y una APK de depuración existen
en `driver-app/`; la validación en un teléfono físico sigue pendiente. Este bloque funda la identidad
móvil antes de permitir llegadas, incidencias, cobros o traspasos. No escribe en
Odoo y no llama a Fleet Routing, Google Routes ni Navigation SDK.

## Reglas de negocio

| Regla  | Actor y resultado                                                                                     | Datos, permiso y auditoría                                                                                                                                     | Validación                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| BL-083 | Administrador habilita el acceso móvil de un chofer activo con su teléfono y un PIN de cuatro dígitos | Credencial separada de `route_drivers` y de `route_users`; el PIN jamás se devuelve ni se guarda en `creation_payload`; auditoría de alta, cambio y revocación | Teléfono canónico único entre accesos habilitados, PIN exacto, versión y revocación de sesiones al cambiarlo       |
| BL-084 | El primer acceso válido vincula automáticamente el teléfono Android                                   | La APK crea una clave no exportable y sólo entrega la clave pública; el servidor registra el dispositivo y audita su identidad                                 | Reintentos o accesos concurrentes con la misma clave reconocen un solo dispositivo; una clave no cambia de chofer  |
| BL-085 | Chofer entra desde el dispositivo autorizado con teléfono y PIN                                       | El servidor valida PIN y prueba criptográfica del dispositivo; sesión móvil independiente de la cookie administrativa                                          | Limitación persistida por cuenta/global, error indistinguible para teléfono o PIN incorrecto, cierre y revocación  |
| BL-086 | Chofer consulta únicamente sus planes, camioneta y pedidos asignados                                  | Identidad sale de la sesión; `route_plan_vehicles.driver_id` y `route_shipments.vehicle_id` se comprueban en servidor; auditoría de acceso                     | Otro chofer, camioneta sin asignación, sesión revocada o chofer inactivo no obtienen datos                         |
| BL-087 | Planificador cambia la asignación de chofer de una camioneta                                          | La asignación del plan y el catálogo de flota no se confunden; el acceso móvil sigue la asignación vigente del plan                                            | Una diferencia entre ambas fuentes se muestra como conflicto operativo; no se adivina ni se concede acceso cruzado |

El administrador puede establecer o sustituir el PIN, pero no volver a leerlo.
El primer acceso combina teléfono mexicano canónico, PIN, limitación persistida
y la clave pública creada en Android Keystore. Después el dispositivo demuestra
posesión de su clave privada mediante un desafío firmado. No existen códigos de
activación, no se envían SMS y no se contrata otro servicio.

## Escenarios M01..M14

| ID  | Precondición / disparador                                    | Resultado y datos                                                                       | Auditoría / fallo / recuperación                                |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| M01 | Admin habilita PIN a chofer activo con teléfono válido       | Credencial canónica única, PIN protegido                                                | `driver.mobile.enabled`; conflicto no cambia credencial         |
| M02 | Dos choferes intentan usar el mismo teléfono de acceso       | Sólo uno puede habilitarlo                                                              | 409 y corregir teléfono; no enumerar desde la APK               |
| M03 | Admin cambia PIN o revoca acceso                             | Sesiones/dispositivos previos dejan de autorizar                                        | Evento sin PIN; el chofer vuelve a entrar con datos vigentes    |
| M04 | App presenta teléfono, PIN y clave pública por primera vez   | Dispositivo registrado automáticamente y sesión emitida                                 | Sin código manual ni servidor editable en la APK                |
| M05 | Primer acceso se repite o compite con la misma clave pública | Se reutiliza el mismo dispositivo sin duplicarlo                                        | Transacción y unicidad de huella criptográfica                  |
| M06 | Clave malformada o registrada por otro chofer                | Ningún dispositivo ni sesión nueva                                                      | Error genérico; no se transfiere identidad                      |
| M07 | Teléfono autorizado presenta PIN y firma válidos             | Sesión móvil con vencimiento                                                            | No reutilizar desafío ni firma                                  |
| M08 | Teléfono desconocido/PIN errado/dispositivo ajeno            | Misma respuesta genérica, sin datos de clientes                                         | Intentos persistidos; bloqueo temporal y recuperación por admin |
| M09 | Chofer inactivo, dispositivo o sesión revocados              | Acceso denegado inmediatamente                                                          | Cerrar sesión local y exigir teléfono + PIN vigentes            |
| M10 | Chofer con plan y camioneta asignados consulta ruta          | Sólo pedidos de su `vehicle_id`, en secuencia y con estado explícito del cálculo        | No confiar en IDs que mande el móvil                            |
| M11 | Otro chofer pide un plan/folio ajeno                         | 403/404 sin contenido ajeno                                                             | Prueba de aislamiento con PostgreSQL real                       |
| M12 | Plan no calculado, cálculo obsoleto o sin camioneta          | Estado honesto; jamás dibujar ruta calculada que no corresponde                         | Se conserva lectura de pedidos propios si procede               |
| M13 | Cambia la flota después de guardar el plan                   | No se presume una reasignación del plan                                                 | Conflicto visible al admin; resolver explícitamente             |
| M14 | Dispositivo sin red                                          | Puede conservar sólo datos ya autorizados y protegidos; no confirmar mutaciones remotas | Sin sesión nueva ni traspaso offline                            |

## Flujo y límites del primer bloque

1. Admin configura acceso en **Editar chofer**, separado del guardado de su
   ficha y de sus documentos. El teléfono se normaliza a diez dígitos mexicanos;
   se aceptan formato nacional, `+52` y el prefijo histórico `+521`.
2. La APK conoce por compilación el origen HTTPS del entorno. En el primer
   acceso crea una clave asimétrica en Android Keystore y presenta teléfono,
   PIN y clave pública al servidor. El servidor no guarda la clave privada.
3. Para entrar posteriormente, el servidor emite un desafío corto y de un
   solo uso; la APK lo firma y envía teléfono + PIN. La sesión resultante es
   independiente de la de administradores, revocable y de duración acotada.
4. La API móvil lee la identidad de esa sesión y filtra plan, camioneta y
   pedidos en PostgreSQL. No acepta `driver_id` o `vehicle_id` del móvil como
   autorización. Devuelve sólo el detalle operativo, nunca credenciales,
   documentos privados ni identificadores secretos del ruteo.
5. La app inicial muestra acceso y ruta asignada. Llegué, evidencia, cobro,
   devolución, navegación en vivo, corrección de punto y transferencias son
   bloques posteriores; no se dibujan botones que aparenten ejecutarlos.

## Estado de implementación y pendientes

- API, migraciones v10/v11, panel de PIN, enrolamiento automático,
  autenticación de dispositivo y lectura aislada: implementados en `develop`.
- Cliente Android: APK debug `0.1.1` compilada con pruebas unitarias y lint
  verdes. Falta la prueba en teléfono físico antes de distribución general.
- M13 necesita aviso de conflicto al administrador; por ahora la API niega el
  acceso cruzado de forma segura, pero no ofrece resolución en el panel.
- M14 es requisito posterior de modo sin conexión; este primer bloque no guarda
  pedidos en el celular y no presenta datos viejos como vigentes.
- No está autorizado ejecutar entrega, incidencia, devolución, liquidación ni
  traspaso desde esta app hasta completar los bloques correspondientes.

## Frontera de traspaso posterior

El emisor podrá seleccionar pedidos aún transferibles, el receptor aceptará o
rechazará por pedido o aceptará todos. Hasta la aceptación, el pedido pertenece
al emisor. El cambio de `vehicle_id` y versión será atómico, idempotente,
auditado y validará nuevamente ambas asignaciones. Una aceptación sin red no
se presenta como realizada. El recálculo de las rutas afectadas no puede usar
Fleet Routing; cualquier SKU distinto debe exponerse antes de activarse.
La custodia física deberá registrarse separadamente de la asignación digital.

## Seguridad, referencias y puertas

- Odoo continúa de sólo lectura. No se crean cobros ni optimizaciones de fondo.
- Secretos por entorno; PIN y clave privada no aparecen en respuestas de
  listado, auditoría, trazas, bundles ni capturas de QA.
- Sesiones administrativas y móviles tienen ámbitos distintos. Cambio de PIN,
  baja del chofer o revocación del dispositivo invalidan acceso.
- Migración aditiva y transaccional sobre PostgreSQL dedicado; se conservan
  planes, rutas, usuarios, flota y datos existentes.
- Pruebas unitarias, integración PostgreSQL real, concurrencia, autorización,
  regresión, Gherkin, cobertura y mutación dirigidas. Cero mocks.
- Referencias: https://pages.nist.gov/800-63-4/sp800-63b.html ;
  https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html ;
  https://developer.android.com/privacy-and-security/keystore ;
  https://developer.android.com/topic/architecture/data-layer/offline-first .

Veredicto previo: GREEN LIGHT para implementar **identidad y lectura solamente**.
Auditoría incremental: INTEGRITY TOTAL respecto a BL-002/003, BL-007..017,
BL-030 y BL-063: no reinterpreta cuentas administrativas ni eventos de llegada.
El traspaso y las finanzas permanecen fuera de esta construcción.

Evidencia reproducible: `QA-BLOQUE-APK-CHOFER-ACCESO.md`.
