# Prueba temporal sin regreso a bodega

Autorización explícita del propietario: mostrar y habilitar Liquidar toda la ruta
debajo de los pedidos para probar ahora; restaurar bodega cuando lo confirme.
Sustituye temporalmente sólo la precondición de bodega de BL179/181 y LR02/03/16.

## Diagnóstico y contrato

Android oculta las acciones con completedAt; política, comando de solicitud y
triggers SQL requieren cierre operativo. Cambiar solamente el botón no funciona.
Esquema41 agrega settlement_require_warehouse a la configuración operativa real.
Se inicializa false para la prueba autorizada. Servidor y SQL consultan el mismo
valor; Android recibe warehouseRequired. La app no puede modificarlo.

Con false y sin cierre operativo se exige que TODOS los pedidos de la ejecución
estén delivered, que existan pedidos y que todos tengan recibo. Se mantienen
propietario, dispositivo, rol settlement, reservas, exclusión de recibos aceptados,
revisión de importes, idempotencia, integridad SQL y aceptación total antes de
Finalizar trabajo. Los comandos existentes de GPS y Terminar ruta no cambian:
la excepción no fabrica llegada ni registro de cierre operativo.

Se conserva resumen real y auditable. Al activar true en el servidor, las mismas
APK vuelven automáticamente a exigir el cierre en bodega. Cierres y recepciones
anteriores conservan su historia; reintentos idénticos devuelven el resultado
guardado aunque la política ya se haya restaurado.

## Matriz y bloques

| Caso | Resultado y prueba |
| --- | --- |
| TB01 | Todos entregados/cobrados y false: elegible sin bodega; unidad/PG/HTTP |
| TB02 | Pendiente, en atención o reprogramado sin cierre: no agrupa ni finaliza; unidad/SQL |
| TB03 | Entregado sin cobro: bloqueo conservado; unidad/PG/SQL |
| TB04 | Paquete pendiente de aceptación: no finaliza; PG/HTTP |
| TB05 | Todos aceptados: resumen único real; PG/HTTP/reintentos |
| TB06 | Restaurar true: lectura y comandos rechazan sin bodega; unidad/PG/SQL |
| TB07 | Cliente intenta cambiar modo: ignorado, servidor autoritativo; PG/HTTP |
| TB08 | Repetir migración/restauración: configuración e historia preservadas; PG |
| TB09 | Actualización modo: fingerprint propietario cambia y Android refresca; PG |
| TB10 | Acción al final, confirmación/cancelación, modo visible y footer accesible; Compose compilado/QA física |

Bloque1: configuración/SQL/políticas/comandos y regresiones estrictas.
Bloque2: acciones Android, panel y verificación HTTP/PG.
Bloque3: cobertura/mutación/Gherkin/JVM/build/firma/APK y QA reproducible.
GPS intacto; sin nuevas dependencias ni escritura Odoo. Guía local Next
Route Handlers16.3.8 consultada. Auditoría local GREEN LIGHT, INTEGRITY TOTAL,
MATCH PERFECT para TB01..10; QA física según excepción vigente del propietario.

Evidencia final de los tres bloques y límites de ejecución en
QA-LIQUIDACION-PRUEBA-0.8.17.md; APK0.8.17/code39 y entrega develop.
