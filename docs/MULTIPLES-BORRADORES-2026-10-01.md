# Borradores independientes y otra salida el mismo día

Autorizado por el propietario el 2026-10-01: «Sí, ejecuta estos bloques».
Origen develop f1236c6. No desplegar, no modificar main ni Five. No usar ui-ux-pro-max.

## Autopsia y contrato

`route_plans.service_date UNIQUE` y `createPlan ON CONFLICT(service_date)`
convertían toda creación del mismo día en una consulta del plan anterior. El
mensaje de Dashboard anunciaba ese comportamiento. Pedidos, publicaciones,
ejecuciones, fotografías, cobros y liquidaciones ya referencian el UUID del plan.

BL186: cada intención nueva genera un plan vacío con UUID distinto, aunque
coincidan fecha y nombre. La fecha es atributo de operación, no identidad.
Reintentar el mismo commandId del mismo administrador y contenido devuelve el
mismo plan y genera una sola auditoría. Cambiar contenido con esa clave falla;
borrar el plan no permite que un reintento lo resucite. Clientes anteriores sin
commandId pueden crear planes nuevos. Se preservan UUID, asignaciones,
snapshots, cobros e historial existentes.

BL187: se pueden preparar/publicar varias salidas del mismo día. El dashboard
prioriza la salida iniciada cuyo trabajo aún no finaliza, incluso si regresó
a bodega y espera liquidación. Otro plan publicado no desplaza esa salida.
Iniciar otra salida del mismo chofer o unidad se rechaza mientras exista una
publicación iniciada no cancelada sin cierre de trabajo. Tras liquidar y finalizar
trabajo, puede comenzar otra publicación con fotos propias. La primera permanece
finalizada e histórica y no reaparece en vivo.

## Bloques y alcance

MB-T01: migración42 transaccional y repetible; retirar sólo unicidad de fecha,
ledger durable por actor+commandId, orden estable por fecha/creación/UUID.
Crear/consultar/auditar con autorización en transacción. Ledger sin FK al plan
para conservar tombstone después de borrarlo. Ninguna copia de pedidos o flota.

MB-T02: Dashboard conserva clave al reintentar el mismo formulario y cambia al
abrir otra creación o editar contenido. Aviso correcto. Selector móvil prioriza
salida iniciada; guarda de inicio bajo lock de flota existente, frente a ambos
recursos y todos los días. Android conserva contrato y explica el conflicto.

MB-T03: PostgreSQL real aislado, HTTP/navegador reales, sin servicios simulados
ni escrituras Odoo. Segunda salida y aislamiento financiero; regresión, cobertura,
mutación, permisos y recuperación. Typecheck/lint/build/migrador y APK si cambia
Android. Excepción física vigente del propietario; compilación no es QA física.

## Matriz de aceptación y riesgo

| Caso | Resultado verificable | Bloque |
| --- | --- | --- |
| MB01 | Dos intenciones, misma fecha/nombre: dos UUID y planes vacíos | 01 |
| MB02 | Misma clave/contenido concurrente: un UUID y una auditoría | 01 |
| MB03 | Claves distintas concurrentes: planes distintos | 01 |
| MB04 | Misma clave con nombre/fecha distintos: conflicto sin mutación | 01 |
| MB05 | Clave perteneciente a otro actor: aislamiento | 01 |
| MB06 | Actor inactivo/liquidador/no autenticado: denegado | 01 |
| MB07 | Fecha, nombre o clave inválidos: rechazo sin escritura | 01 |
| MB08 | Reintento tras editar conserva plan y solicitud original | 01 |
| MB09 | Reintento después de borrar no recrea el plan | 01 |
| MB10 | Migrar41→42, nueva instalación, repetir/rollback: datos conservados | 01 |
| MB11 | Listado con fechas/empates: orden determinista | 01 |
| MB12 | Formulario: misma solicitud tras fallo; nueva clave por intención | 02 |
| MB13 | Crear/publicar otro plan no desplaza ruta iniciada | 02 |
| MB14 | Segunda salida antes del cierre financiero: rechazada | 02 |
| MB15 | Segunda salida después del cierre financiero: permitida | 02 |
| MB16 | Inicios simultáneos de dos planes: sólo uno inicia | 02 |
| MB17 | Camioneta ocupada por otro chofer: nueva salida rechazada | 02 |
| MB18 | Fotos, pedidos, ejecución y cobros separados entre salidas | 02 |
| MB19 | Primera salida histórica y fuera de live tras cierre | 02 |
| MB20 | Cancelación legítima libera salida; permisos/revisiones intactos | 02 |
| MB21 | Browser crea otro borrador del día y no abre el previo | 03 |
| MB22 | HTTP publicar→fotos→iniciar otra salida; evento actualiza cliente | 03 |

Objetivo por riesgo: validar el100% de escenarios críticos de identidad y recursos;
cobertura medida de líneas/ramas sobre esos contratos. Mutation testing demuestra
detección de identidad incorrecta, autorización omitida, mezcla de planes y
eliminación de guardas. Medir latencia, fallos, complejidad y límites de QA.
Conservar el modo de prueba autorizado sin bodega, sin fabricar llegada GPS.

Todos los MB01..22 tienen tarea y validación. MATCH PERFECT.
