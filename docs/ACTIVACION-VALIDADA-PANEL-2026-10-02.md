# BL192 — bloqueo de activación en el panel

Corrección expresamente solicitada el 2026-10-02 dentro del bloque de validación
por camioneta. El usuario señaló Activar ruta del panel, que llama a publishRoutes;
BL191 protegió startDriverRoute de Android y permitió publicar pendientes. Esa
interpretación fue incorrecta. Este contrato sustituye exclusivamente el permiso
de publicación con pendientes descrito en BL191, sin retirar sus defensas móviles.

## Bloque autorizado

1. Deshabilitar Activar ruta / Guardar y publicar por camioneta y mostrar sus folios
   pendientes. Deshabilitar la confirmación individual abierta si llega un cambio
   pendiente. La confirmación conjunta sigue disponible e informa las omisiones.
2. Proteger publishRoutes bajo los locks existentes, antes de cualquier escritura.
   Aclaración explícita posterior del usuario: Publicar rutas activa las camionetas
   completas y omite sólo las pendientes, informando sus nombres y folios. Las
   camionetas omitidas no sufren escrituras/revisiones. El conjunto validado mantiene
   la transacción existente. La activación individual pendiente responde 409.
3. Validar política compartida, PostgreSQL, HTTP/navegador real, concurrencia,
   permisos, regresión, cobertura y mutaciones; entregar develop sin desplegar.

## Invariantes

- Sólo fulfillmentStatus=validated permite activar. Estados desconocidos/null
  bloquean; el fallback histórico de importaciones antiguas sigue en readOrderBoard.
- Cancelados/sin productos conservan ODOO_DELIVERY_UNAVAILABLE.
- Publicaciones ya iniciadas no se alteran ni se bloquean retroactivamente.
- Se conservan cargar, asignar, ordenar y Armar ruta con pendientes, cálculo Google,
  fotografías, inicio móvil, cobros, liquidación, historial y permisos existentes.
- Sin migración, nuevos endpoints, cambios Android ni cambios a la cadencia Odoo.
- El evento existente del worker actualiza el tablero y habilita automáticamente
  la activación al validar el último pendiente. El servidor vuelve a comprobarlo
  ante UI vieja o peticiones directas; cambios simultáneos respetan VERSION_CONFLICT.

## Aceptación (Gherkin)

```gherkin
Feature: Activación administrativa con pedidos validados de cada camioneta
  Scenario: Pendientes dentro de la camioneta seleccionada
    Given una camioneta con un pedido validado y dos pendientes de Odoo
    When el administrador consulta Activar ruta o intenta el POST directo
    Then el botón está deshabilitado y el servidor responde 409 con ambos folios
    And no cambian publicaciones, revisiones, avisos al chofer ni pedidos

  Scenario: Otra camioneta y pedidos sin asignar pendientes
    Given todos los pedidos de la camioneta A validados
    And pendientes en B y sin asignar
    When el administrador activa A
    Then A se publica y los otros pendientes conservan su estado

  Scenario: Publicación conjunta parcial por validación
    Given A validada y B pendiente
    When el administrador intenta Publicar rutas
    Then se activa A y B conserva su estado sin revisión ni avisos al chofer
    And se informa la camioneta B y los folios que falta validar
    When todas las camionetas tienen pendientes
    Then se informan todas sin afirmar que se activó alguna

  Scenario: Validación posterior y modal abierto
    Given la confirmación individual abierta para una camioneta inicialmente validada
    When llega un estado pendiente por el evento existente
    Then la confirmación se deshabilita y muestra los folios
    When el último pedido vuelve a validado
    Then se habilita sin recargar manualmente ni modificar la cadencia Odoo

  Scenario: Worker y dos activaciones concurrentes
    Given el worker tiene el lock del plan para validar el último pedido
    When se intenta activar con una versión anterior
    Then la petición espera y responde VERSION_CONFLICT después del commit
    When dos peticiones repiten la activación con la versión vigente
    Then se crea una sola revisión y una sola auditoría de publicación

  Scenario: Seguridad y recorrido iniciado
    Given una sesión ajena, sin permiso o sin Origin válido
    When intenta publicar
    Then se rechaza sin datos ni escrituras
    Given otra camioneta ya iniciada
    Then sus pedidos e historial no interfieren con la activación de las restantes
```

Objetivo de cobertura: 100% líneas/ramas de la política nueva y ambas respuestas
de su guarda transaccional. Riesgo: habilitación operacional, aislamiento y
atomicidad; validar por escenarios reales, no por el promedio del archivo legado.
QA y métricas finales en QA-ACTIVACION-VALIDADA-PANEL-2026-10-02.md.
