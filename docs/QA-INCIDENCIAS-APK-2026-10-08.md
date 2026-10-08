# IO-T02 — formularios de incidencias Android

Autorización: «Sí, continúa con APK y panel». Rama develop, base 99b8c9b.
APK de pruebas 0.8.23 / code45. Sin deploy ni cambios en producción.

## Comportamiento verificado

- Llegada ofrece sólo Cliente cerrado y Pedido rechazado. Los faltantes
  permanecen en la ficha del pedido con sus restricciones de atención.
- Catálogo v3 por tipo: cuatro conceptos incluyendo Error en compra, motivo
  nuevo de bodega, comentario Llegada tardía en validación y los tres comentarios
  exclusivos de devolución. Devolución omite departamento/concepto.
- Foto obligatoria en devolución y reposiciones: cantidad válida 1..3 y todas
  las miniaturas listas antes de habilitar Guardar. Se conserva validación real
  de imagen, límites, evidencia privada y confirmación del servidor.
- Capturas nuevas y ediciones explícitas envían v3. El transporte conserva v2
  y las tres fotos. Cola, claves, payload persistido y consulta previa del recibo
  no se reescriben. No se modifican cantidad disponible, pagos ni cobros.
- Al cambiar tipo sólo se limpian selecciones incompatibles del borrador. Al
  abrir un registro antiguo se muestran sus comentarios anteriores; una edición
  incompatible exige retirarlos explícitamente. El registro auditado original
  permanece. No se reclasifica historia automáticamente.

## Ejecución y métricas

En driver-app, con JAVA_HOME y ANDROID_HOME locales:

```powershell
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport assembleDebug assembleDebugAndroidTest lintDebug --console=plain
```

168 pruebas JVM verdes, cero fallos. Compilación de APK y APK instrumentada
correcta; lint sin errores, 36 advertencias de herramientas/API/recursos ya
presentes, sin actualización de dependencias. Validación de firma por apksigner.

JaCoCo: ProductIncidentPolicy 62/62 líneas (100%), 105/106 ramas (99.06%);
IncidentFormPolicy 8/8 líneas y 6/6 ramas; ProductPhotoUpload 20/20 líneas y
18/18 ramas. Todas las ramas nuevas de catálogo, clasificación y elección de
transporte cubiertas. Complejidad ciclomática de estas funciones: máximo 4;
la rama no cubierta pertenece al parser decimal existente.

La revisión encontró y corrigió un cierre de bloque faltante antes del build
verde. Una compilación instrumentada intermedia coincidió con una extracción
de componente; se repitió completa sobre los archivos finales. Ninguno de esos
intentos se usa como evidencia de aprobación.

12/12 mutaciones dirigidas detectadas en copia temporal aislada: clasificación,
catálogos, comentarios incompatibles, compatibilidad v2/v3 y obligatoriedad/límite
de fotos. Diez ejecutadas en `.local/io-apk-mutations.log`; las últimas dos se
ejecutaron en `.local/io-apk-mutations-photo.log` tras precisar un ancla ambigua
del script (el intento sin prueba no se contó como mutante detectado).
Reproducción completa: `driver-app/scripts/verify-incident-organization-mutations.ps1`.

Ocho pruebas del contrato backend verdes en PostgreSQL real aislado, incluyendo
v2/v3 multipart con tres JPEG, rechazo sin evidencia, auditoría y saldos intactos:
`npx vitest run tests/product-incident-organization.test.ts tests/product-incident-form.test.ts tests/product-incident-photos.test.ts`.
Evidencia `.local/io-apk-contract.log`. No se llamó Odoo, Google ni producción.

Evidencia local: `.local/io-apk-build-final.log`, `.local/io-apk-qa-final.log`,
`driver-app/app/build/test-results/testDebugUnitTest`, reportes JaCoCo y lint.
SHA-256 APK: `b32a7983ac2d9485e10d16d81c64bdedb4c18c0aea27b46d6fccd4031577cef2`.

## QA de dispositivo pendiente

ADB sólo encuentra emulator-5554 offline; no hay dispositivo operativo. Las
pruebas Compose se compilaron; no se declara ejecutada la cámara/IME física.
El bloque aprobado exige QA físico disponible y documentar esta limitación.
No certifica distribución productiva. Primero desplegar backend compatible v3
(esquema 46 o posterior), después instalar sobre 0.8.22 sin borrar datos.

1. Abrir una parada con llegada confirmada: selector exterior de dos opciones.
2. Abrir pedido y sus cinco tipos; seleccionar los nuevos conceptos/motivos.
3. Devolución: verificar ausencia de clasificación y tres comentarios exactos.
   Sin foto, Guardar deshabilitado; cancelar cámara, imagen ilegible y borrar
   última foto mantienen el bloqueo. Una/tres fotos válidas permiten guardar.
4. Cambiar tipo, rotar y volver: comprobar notas, cantidades y fotos conservadas
   salvo selección incompatible retirada explícitamente al cambiar tipo.
5. Reintentar un envío pendiente v2 tras actualizar: mismo folio y tres fotos,
   sin duplicación. Capturar v3 y cortar conexión después del guardado: reintento
   confirma el mismo recibo y libera sólo sus archivos locales.

La latencia de servidor queda en QA-INCIDENCIAS-BLOQUE1-2026-10-08.md;
no se atribuye latencia de red o cámara a una prueba JVM.
