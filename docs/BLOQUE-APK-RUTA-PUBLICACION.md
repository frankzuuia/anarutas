# Bloque móvil 2B — publicación, inspección de unidad e inicio de ruta

## Realidad comprobada (22/09/2026)

- `route_plan_vehicles` y `route_shipments` son hoy borradores vivos. La API móvil los lee directamente; no existe publicación por camioneta ni evento de inicio.
- `route_optimization_runs` guarda recorridos, métricas y trazos; `DriverApi.kt` sólo consume métricas y paradas, no la polilínea.
- Mover pedidos incrementa `route_plans.version`; la migración v7 encola recálculo vial automático y `routing-worker` puede llamar Google Routes. Publicar sin editar el plan no debe encolar ese trabajo.
- La APK no tiene todavía mapas, permisos de ubicación, cámara ni almacenamiento de fotos de unidad. Los documentos privados del chofer actuales son otro dominio y se guardan en PostgreSQL; no reutilizarlos para fotos temporales.
- EasyPanel App pierde archivos del contenedor al recrearlo si no hay volumen persistente. La instalación develop no tiene aún el volumen de fotos.

## Reglas de negocio nuevas

| Regla | Actor y resultado | Datos, permiso, auditoría y validación |
| --- | --- | --- |
| BL-088 Publicación | El administrador publica una camioneta o todas las elegibles mediante confirmación. Antes de publicar, el chofer no ve el borrador. | Snapshot por plan/camioneta, versión de publicación independiente e idempotencia; sólo admin activo; auditar quién/cuándo/contenido versionado. Global atómico: si una camioneta elegible falla, ninguna cambia. |
| BL-089 Edición | Un plan publicado no se duplica. Los cambios de una camioneta no iniciada permanecen privados hasta «Guardar y publicar»; entonces reemplazan su snapshot. | Validar versión del plan y versión de publicación, conductor actual y cobertura exacta. Publicar no llama Google ni crea un nuevo plan. |
| BL-090 Inicio | El chofer de la camioneta publicada puede iniciar únicamente su ruta asignada y únicamente tras 5 a 8 fotos válidas de esa unidad/fecha. | Comparación transaccional con sesión móvil, asignación vigente al iniciar, fecha local y fotos persistidas. Tras iniciar, la ruta conserva a ese chofer aunque cambie la asignación persistente de flota. Segundo toque es idempotente; no hay inicio offline ficticio. Auditar. |
| BL-091 Inmutabilidad | Al iniciar una ruta, no se puede alterar su responsable publicado, unidad, pedidos, orden o snapshot, ni borrar el plan. La asignación persistente de flota sí puede cambiar para planes futuros sin transferir la ruta iniciada. Otras camionetas pueden recibir cambios y republicarse. | Guardas transaccionales para cada mutación administrativa y optimización; prueba de concurrencia iniciar/editar y rollback íntegro. |
| BL-092 Fotos | El chofer toma o elige hasta 8 fotos de su unidad; 5 distintas y válidas habilitan Inicio. | WebP procesado en servidor, archivos privados en volumen persistente, metadatos en PostgreSQL, sin base64 en BD. Acceso sólo al chofer asignado y a administradores. Límites de tamaño/píxeles, contenido verificado, deduplicación, auditoría. |
| BL-093 Retención | Fotos de unidad se eliminan automáticamente tras 15 días, no las de documentos del chofer. | Worker por proceso con exclusión local; primero se invalida acceso, luego se borra archivo. Reconciliar huérfanos; fallos reintentables. En varios procesos, la base evita doble borrado, pero no hay lease distribuido. Backups externos requieren política coherente de retención. |
| BL-094 Navegación | Desde Ruta se abre el mapa real; tras Inicio queda acceso centrado abajo desde cualquier pantalla. | Dibujar recorrido/paradas reales y usar Navigation SDK para indicaciones de giro reales. No crear instrucciones a partir de una polilínea. Conservar secuencia administrativa y sesión de navegación al cambiar de pantalla. |
| BL-095 Control de unidades | Administración ve tarjetas de unidades activas y fotos por fecha/plan; sólo lectura de evidencia. | Consulta autenticada y paginada, imagen privada, fecha local y estado de expiración. No exponer rutas de archivo ni fotos de otra instalación. |

## Estados por camioneta

`borrador` → `publicada` → `iniciada`. Publicar de nuevo una camioneta publicada y no iniciada actualiza el snapshot, no crea otro estado paralelo. `iniciada` es irreversible desde las acciones actuales; el eventual cierre de ruta será otro bloque. Un plan puede tener camionetas en estados distintos. El borrado de un plan sólo procede si ninguna camioneta inició. El estado de una camioneta no se infiere de la versión global del plan.

## Escenarios de aceptación

| ID | Actor/precondición | Disparador | Resultado, auditoría y fallo |
| --- | --- | --- | --- |
| MR01 | Chofer asignado, borrador | Abre Inicio | No recibe plan, pedidos ni trazo; 200 vacío, no 404 engañoso. |
| MR02 | Admin, plan con conductor y pedidos | Publica una camioneta | Snapshot exacto visible sólo a ese chofer; evento `route.published`. |
| MR03 | Admin, varias camionetas | Publica todas | Una transacción; no duplica publicadas; error de una elegible revierte todas. |
| MR04 | Admin, ruta publicada no iniciada | Edita pedido | Chofer conserva último snapshot; nueva versión sólo tras republicar. |
| MR05 | Admin, versión antigua o doble toque | Republica | 409 en conflicto; petición idéntica no duplica ni llama Google. |
| MR06 | Chofer, menos de 5 fotos válidas | Toca Inicio | 409 con conteo actual; cero evento de inicio. |
| MR07 | Chofer, 5-8 fotos válidas y ruta publicada | Toca Inicio | Inicio único con hora del servidor, unidad/plan exactos y auditoría. |
| MR08 | Chofer, 8 fotos | Sube otra | 409, no crea archivo accesible ni metadato. |
| MR09 | Chofer de otra unidad o sesión revocada | Lee/sube foto o inicia | 404/401 sin filtrar existencia; ningún cambio. |
| MR10 | Admin, una camioneta iniciada | Edita otra | Sólo la no iniciada cambia y se republica; la iniciada conserva snapshot/orden. |
| MR11 | Admin, camioneta iniciada | Mueve/borra su pedido o borra plan | 409 íntegro, sin efecto parcial ni nueva llamada Google. La reasignación de flota queda permitida sólo para rutas futuras y no cambia el propietario de esta ruta. |
| MR12 | Inicio y edición concurrentes | Ambas transacciones | Una gana; la otra recibe 409. Nunca arranca con foto/ruta que ya cambió. |
| MR13 | Foto guardada, 15 días cumplidos | Worker de limpieza | Deja de ser accesible y elimina archivo; reintenta fallo y no toca documentos. |
| MR14 | Volumen ausente/lleno o imagen corrupta | Subir foto | Error explícito, ninguna foto se contabiliza para iniciar. |
| MR15 | GPS negado, señal perdida o SDK sin cuota | Abre mapa | Muestra ruta/parada guardadas con aviso; no inventa posición ni giro. |
| MR16 | Chofer inició y cambia a Pedidos/Perfil | Toca acceso inferior Mapa | Retoma la misma navegación sin solicitar de nuevo el mismo destino por simple cambio de pantalla. |
| MR17 | Admin ve unidad activa | Filtra fecha | Sólo evidencia vigente de esa unidad/fecha, con plan y fecha reales. |

## Contrato y dependencias entre bloques

1. **Publicación y guardas:** migración aditiva, snapshots por camioneta y API admin/móvil. La publicación no incrementa `route_plans.version`; las ediciones sí conservan la política existente de recálculo, que debe hacerse visible y controlable antes de desplegar el flujo completo.
2. **Fotos e Inicio:** volumen privado configurado antes de habilitar capturas; procesamiento WebP, metadatos, worker de 15 días, API móvil/admin e inicio transaccional. Sin volumen, Inicio permanece cerrado y la UI muestra el motivo.
3. **APK premium:** Inicio compacto, tarjeta Ruta activa, métricas/recorrido/paradas, captura cámara/galería y botón Inicio sólo cuando el servidor devuelve 5 fotos válidas; ningún botón ornamental.
4. **Mapa:** Navigation SDK nativo, clave Android restringida a paquete y certificado, permisos de ubicación graduales, destinos por secuencia y acceso inferior persistente tras Inicio. Abrir/cerrar la pantalla no debe disparar nuevas solicitudes de ruta por sí solo. No prometer identidad geométrica entre la polilínea planificada y el trayecto que Navigation SDK actualice por tráfico.
5. **Panel:** botones individual/global con confirmación, estados «Publicada» y «Guardar y publicar», guardas de borrado, y «Control de unidades» por fecha.

## Fuentes y costos

- [Google Navigation SDK, integración y guía real](https://developers.google.com/maps/documentation/navigation/android-sdk/overview): instrucciones de giro y mapa se originan en el SDK, no en texto simulado.
- [Navigation SDK, uso y facturación](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing): solicitud para calcular destino es facturable según SKU/volumen; iniciar guía o volver a la misma vista no añade una tarifa de guía. Medir solicitudes reales en QA.
- [Android Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker): selección limitada de medios sin permiso general a galería.
- [EasyPanel App storage](https://easypanel.io/docs/services/app): volumen persistente obligatorio para archivos de unidad; disco efímero del contenedor no sirve.

## Puertas

Unitarias de políticas/serialización, integración PostgreSQL real, HTTP autenticado, Android unit/instrumentación, E2E admin→chofer, concurrencia, seguridad de media, expiración, cuota y fallo GPS; Gherkin para MR01..17. Medir cobertura del código crítico, mutation testing sobre publicación/inicio/guardas y métricas de latencia/errores/solicitudes Google. No commit/push/deploy sin evidencia verde o excepción explícita del usuario.

Veredicto documental: **GREEN LIGHT para construir por bloques locales**. No certifica navegación live, volumen EasyPanel ni APK física. Integridad: el snapshot publicado separa borrador de lectura móvil; BL-017 se amplía para permitir borrar publicado no iniciado. Correspondencia MR01..17 ↔ tareas MP-T01..MP-T08 en `PROGRESS.md`.
