# QA — cancelar una publicación y detectar cambios propios

Fecha: 23/09/2026. Alcance: BL-104 / CP01..06. Entorno: Next compilado, navegador local y PostgreSQL efímero real; sin modificar datos de develop/producción ni enviar notificaciones a choferes reales.

## Causa y corrección

Cancelar estaba condicionado a `started_at` en panel, dominio y SQL. Una publicación todavía no iniciada carecía de acción de retiro. Además, la existencia de publicación mostraba «Guardar y publicar» permanentemente, y la comparación incluía la versión global del plan.

Ahora se revoca una publicación vigente con revisión/versiones esperadas y locks plan→publicación. No se borran ni desasignan pedidos; tampoco cambian su secuencia, las fotos o la asignación de la camioneta. La auditoría distingue cancelación previa al inicio de cancelación de un inicio. Al volver a publicar aumenta la revisión. El retiro de una ruta vaciada explícitamente también conserva la fila revocada y la revisión creciente para no colisionar con la deduplicación FCM.

`has_changes` compara contenido publicado por camioneta, chofer de flota y huella de entradas viales. Ignora versión global, orden de claves JSONB y numeración absoluta de pedidos dentro del plan; conserva la comparación de la secuencia propia. Compatible con snapshots anteriores sin huella. Leer/publicar/cancelar no introduce llamadas Google/Odoo.

## Aceptación (Gherkin)

```gherkin
Feature: Retirar una ruta conservando la preparación administrativa
  Scenario: Cancelar antes de que el chofer inicie
    Given una ruta publicada con pedidos asignados en un orden determinado
    And el chofer no la ha iniciado
    When el administrador confirma Cancelar ruta
    Then el chofer deja de verla y no puede iniciar la revisión retirada
    And los mismos pedidos permanecen asignados a la misma camioneta en el mismo orden
    And se conserva la evidencia fotográfica
    And se registra una cancelación previa al inicio y una intención FCM de retiro

  Scenario: Cerrar la confirmación sin cancelar
    Given la confirmación de cancelación está abierta
    When el administrador elige Conservar ruta
    Then la publicación permanece visible y no se genera un retiro

  Scenario: Cancelar un inicio y volver a publicar
    Given una ruta iniciada y el administrador confirma que puede retirarla
    When cancela y después publica el borrador
    Then el inicio anterior queda auditado y la nueva publicación requiere iniciar de nuevo
    And una revisión anterior no puede iniciar ni modificar la publicación nueva
    And las fotos válidas del día siguen disponibles

  Scenario: No republicar por cambios ajenos
    Given dos camionetas publicadas sin cambios propios
    When cambia el orden de pedidos de una camioneta
    Then Guardar y publicar sólo aparece para la camioneta modificada
    And publicar no incrementa la revisión ni genera otra intención FCM para la intacta
    And cambiar sólo posiciones globales sin cambiar la secuencia propia tampoco marca cambios

  Scenario: Republicar contenido propio modificado
    Given una publicación vigente sin inicio
    When cambia su chofer, pedido, secuencia, dato visible o entrada vial
    Then se indica que hay cambios sin publicar
    And al publicar se conserva la validación del recorrido y de la flota

  Scenario: Cancelación concurrente con inicio o repetición
    Given una publicación vigente con revisión conocida
    When cancelar compite con iniciar o con otra cancelación
    Then las operaciones se serializan y el estado final retirado no permite inicio
    And un segundo retiro no genera doble auditoría ni doble entrega de notificación

  Scenario: Acceso y edición obsoletos
    Given un cliente sin sesión administrativa o con versión obsoleta
    When intenta cancelar
    Then el servidor rechaza la operación sin alterar pedidos ni publicación

  Scenario: Publicación con borrador vaciado explícitamente
    Given pedidos retirados previamente del borrador por el administrador
    When se cancela o guarda el retiro de la publicación existente
    Then se retira la publicación sin reiniciar su contador de revisión
    And las otras camionetas publicadas no cambian
```

## Ejecución reproducible

1. `npm run typecheck` y `npm run lint`.
2. `npm run test:coverage` (PostgreSQL real por suite, limpieza automática).
3. `npm run test:e2e -- tests/e2e/driver-mobile.spec.ts` (incluye build; navegador + API móvil/admin + SSE + outbox).
4. `npm run test:mutation:route-cancellation` y `npm run test:mutation:route-publication-state`.
5. Revisar `reports/screenshots/route-published-cancel-before-start.png`, cobertura HTML y reportes JSON de mutación. Estos artefactos se excluyen de Git.
6. Tras push, el usuario ejecuta Deploy de `ana-rutas-develop/app`. Publicar una ruta de prueba sin iniciarla, cancelarla y comprobar en el teléfono el aviso de retiro y la desaparición de la ruta. En el panel deben permanecer sus pedidos; editar y volver a publicar. No requiere otra APK ni migración.

## Evidencia y métricas

Puertas base: cobertura global ≥85 % líneas/statement, ≥90 % funciones y ≥80 % ramas; mutación dirigida ≥80 %. Se añaden pruebas de cada decisión crítica y no se usa el promedio para omitir permisos/concurrencia/retención de pedidos.

| Puerta | Resultado de esta ejecución |
| --- | --- |
| Typecheck / lint | Sin errores. Se corrigió un aviso de exportación anónima en la configuración nueva; revalidación del archivo limpia. |
| Build de Next | Correcto; compilación y tipos incluidos en el pretest E2E. |
| Unitarias / integración PostgreSQL | 506 correctas, 46 archivos, 331.66 s. Los 12 escenarios dependientes de publicación se agrupan en un único test atómico, sin eliminar pasos ni aserciones. Un contrato FCM externo omitido expresamente: no se solicitó volver a enviar a Google en este bloque. |
| Cobertura global | 94.82 % líneas, 93.44 % statements, 87.53 % ramas, 96.78 % funciones. |
| Comparador/snapshot nuevo | 100 % líneas/statements/funciones, 90 % ramas. La rama de desempate de posiciones no ocurre en PostgreSQL: el plan exige posiciones únicas. |
| Publicación/cancelación | 97.19 % líneas, 94.78 % statements, 89.53 % ramas, 100 % funciones; contrato/permisos adicionales por HTTP. |
| E2E navegador/API | 2 correctas, 51.4 s. Cancelar antes del inicio, conservar en modal, asignaciones/orden intactos, retiro del dashboard, rechazo de revisión retirada, outbox única y republicación. Token móvil sin sesión admin: 401; origen ajeno con sesión admin: 403. |
| Actualización local | Evento móvil de publicación: 154 ms; inicio visible en panel por SSE: 240 ms; cancelación reflejada en panel/API móvil: 139 ms (objetivo local <2 s). Son muestras, no un p95 productivo. |
| Complejidad ciclomática ESLint | Comparador 3; cancelación transaccional 8; callback de estado propio 11. Publicación transaccional 32, igual que HEAD previo: no se amplía ese valor. |
| Mutación de cancelación | 18/19 detectados, 94.74 %, cero timeouts; 3 min 15 s. El único superviviente elimina la comprobación previa de revisión, pero `UPDATE ... AND revision=$3` y el rechazo de cero filas conservan el mismo 409 sin cambios. Defensa redundante revisada, no un retiro autorizado con revisión obsoleta. |
| Mutación del estado propio/idempotencia | 50/52 detectados, 96.15 %, cero timeouts; 5 min 40 s. Supervivientes: normalizar ambas secuencias con `index-1` es equivalente a `index+1` para comparar igualdad; quitar `optimization?.` no se detecta porque las publicaciones válidas probadas tienen cálculo previo. Se conserva esa protección de lectura para datos incompletos y se declara el límite, no se excluye el mutante. |

La captura del panel tras republicar muestra «Ruta publicada» y «Cancelar ruta», sin «Guardar y publicar» en la camioneta intacta. Otra camioneta todavía en borrador conserva «Activar ruta». Defectos abiertos detectados por las suites finalizadas: cero; no implica ausencia universal de defectos.

Control de validez de mutación: se descartaron los resultados previos con selección de pasos individuales. Los escenarios PostgreSQL comparten el ciclo de vida de una publicación, por lo que seleccionar un paso aislado puede fallar por preparación ausente y no por el mutante. La inspección del adaptador instalado mostró que entrega cobertura por test incluso solicitando `coverageAnalysis: off`, y el planificador utiliza esa cobertura. Por ello los 12 escenarios se ejecutan ahora dentro de un único test atómico con pasos nombrados: el ejecutor no puede saltarse requisitos previos. Se da margen al arranque PostgreSQL en Windows para evitar clasificar lentitud como mutante detectado. Sólo la repetición con ese ciclo completo cuenta como evidencia final.

## Límites

La recepción física FCM de publicación ya fue confirmada por el usuario con la APK 0.4.0. Esta ejecución verifica el retiro en API móvil, señalización local y cola transaccional real; la recepción física del aviso de cancelación queda para la prueba tras Deploy. No se vuelve a enviar a Google ni se mide aquí carga productiva/p95 de red móvil. Sin nueva credencial ni cambio Android. No se certifica producción basándose sólo en pruebas locales.
