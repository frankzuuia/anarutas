# QA — formulario de incidencias 0.6.2

Fecha: 26/09/2026. Base: `1dd7588`, rama develop. Main, five, servidor,
PostgreSQL live, Odoo y configuración de nube fuera del bloque.

## Autopsia y cambio acotado

Detalle anterior: Dialog de ancho propio con decorFitsSystemWindows=true,
altura wrap-content centrada, tope calculado desde la ventana del mapa padre
y sin propietario explícito del IME. El texto/foto modificaban la altura y
el teclado debía relocalizar foco al mismo tiempo. AndroidX documenta el
riesgo de glitches con esa combinación. La reproducción física exacta del
usuario no se afirma desde inspección o JVM.

Nuevo ServiceFormSurface: Dialog decorFitsSystemWindows=false, root de
pantalla completa, safeDrawingPadding/imePadding con consumo compartido,
alineación superior/altura según espacio disponible, encabezado fijo y un
scroll recordado para el cuerpo. Sin temporizador, cambio de foco ni scroll
programado por cada letra. Sólo incidencias/atención usan este contenedor;
DetailSurface de consultas y fotos sigue intacto. Se requiere cierre explícito
o Back; tocar el fondo no descarta accidentalmente el borrador.

Tarjetas con Role.RadioButton y selectableGroup, vectores locales tienda/caja,
paleta grafito/lima, check y borde seleccionados. Sólo dos tipos existentes;
sin «Acceso bloqueado». Permisos derivados de la disponibilidad actual y
pedidos rechazables. Seleccionar no llama API. Comentario antes de foto,
maxLines=4, minLines=2; sigue el límite previo 2,000. Done sólo libera foco
y cierra IME. No nueva lógica de entrega ni autenticación.

## Evidencia ejecutada y métricas

Comando (JDK 21 y SDK Android ya configurados):

```powershell
./gradlew.bat :app:testDebugUnitTest :app:createDebugUnitTestCoverageReport :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain
./scripts/verify-arrival-mutations.ps1 -IncidentFormOnly
```

- Build final exitoso en 36 s (incremental); APK de app y APK instrumentada.
- JVM: 76 tests, 0 fallos/errores. Cuatro nuevos de matriz disponible/pedidos,
  códigos/iconos exactos, parseo vectorial y notas/bordes del límite. Suite nueva
  0.046 s, no es una métrica de latencia del teclado ni de una API.
- JaCoCo IncidentFormPolicyKt: 2/2 líneas, 6/6 ramas, 2/2 métodos.
  IncidentChoice: 3/3 líneas y 6/6 métodos. Riesgo dirigido: 100 %; complejidad
  acumulada de las dos funciones 5 (predicado 4, recorte 1).
- Cobertura JVM global: 423/3220 líneas (13.14 %), 535/3025 ramas (17.69 %).
  No se usa este promedio para certificar UI/cámara/Navigation SDK.
- Mutation: 8/8 muertos por fallos de assertions, ningún superviviente ni fallo
  de compilación contado como detección. Omisión de disponible, rechazo sin
  pedidos, condición invertida, código/icono cambiados, límites 1999/2001 y
  trim indebido. Ejecución en copia temporal, no árbol activo.
  Evidencia: `C:/Users/figod/AppData/Local/Temp/ana-rutas-arrival-mutations-0470b9df61fb4c8c8acdeb194e525c1a/results.json`.
- Lint: 0 errores, 33 warnings; no declarar eliminados los warnings heredados.
- Dos pruebas instrumentadas nuevas compiladas: semántica/deshabilitado de
  tarjetas y teclado real/encabezado/draft/recomposición/Done. **No ejecutadas**:
  usuario realiza QA físico y no autorizó ADB. Gherkin IF01..IF07 registrado.
- No cambió ninguna fuente bajo `src` del servidor; integración HTTP/PG y
  E2E del panel de 0.6.1 no se vuelven a presentar como ejecutadas en este bloque.
- No se midió SLO/frame-time/latencia IME física. Defecto reportado de salto
  queda pendiente de validación del usuario; no afirmar cero defectos físicos.

## Seguridad y artefacto

No permisos nuevos del dominio, endpoints, migración, URLs ni secretos en código.
Backend mantiene las validaciones de foto, motivo y autorización. Rutas privadas
de cámara/FileProvider/outbox/recibo no se modifican. ui-test-manifest sigue el
BOM Compose actual y sólo es dependencia debug; su ComponentActivity vacío se
declara exported=false en debug. No crea entrada externa a sesión/datos y no
se añade a release. Manifest merged verificado. App allowBackup=false y HTTPS
siguen intactos. No se solicita acceso a galería ni se publica evidencia.

Artefacto de prueba: `.local/releases/Five-Rutas-Chofer-0.6.2-develop.apk`.
Paquete `com.five.anarutas.driver`, versionName 0.6.2/code18, min26.
apksigner verify verde y misma firma debug anterior:
`f92d2160eccdadb8b72ac5573ef07dc09eb8fdd57c10621d33afaeb7dd4c2e35`.
SHA256 APK:
`303D9930033791F8564DCAF983FB2908E2510F9B34CC8A1511A21216969786DE`.
No Deploy requerido si backend v23 de 0.6.1 ya está instalado. No se entrega
como release productivo ni como verificación física de IME.

## Procedimiento de aceptación física (pendiente)

1. Instalar sobre 0.6.1, sin borrar datos. Abrir ruta propia, Llegué y Registrar
   incidencia. Confirmar tienda/caja con icono, check y selección exclusiva.
2. En Cliente cerrado escribir cinco líneas: campo debe estar sobre el teclado,
   header sin saltos por letra; desplazar cuerpo y pulsar Listo. Nota conservada
   sin incidencia enviada; teclado cerrado. Tomar/cancelar/repetir foto y
   comprobar que el comentario no se borra. Cancelar no registra incidencia.
3. Pedido rechazado: seleccionar Otro, nota obligatoria y límites intactos.
   Cambiar teclado/fuente grande/rotación; nota/foco/controles alcanzables.
4. Probar notas de Reprogramar y teléfono operativo ausente, sin enviar un
   cambio ajeno al escenario. Done no confirma ninguna operación.
5. Confirmar con datos de prueba un cerrado con foto y un rechazo: recibo,
   panel/fecha/chofer/mapa como 0.6.1. Probar red incierta sin duplicación.
6. Ver paradas, productos y fotos de unidad; comprobar que las consultas siguen
   iguales. Repetir navegación/GPS; radio/voz/llegada no modificados.

Registrar modelo/versión Android, teclado, tamaño/fuente, resultado y vídeo
del fallo si persiste. Sin prueba física verde permanece abierta IF-T04.
