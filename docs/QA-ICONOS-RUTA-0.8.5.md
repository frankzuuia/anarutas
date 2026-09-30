# BL-153 — iconos de métricas, APK 0.8.5

2026-09-29, develop. Único cambio de interfaz: `RouteMetric` recibe el tinte
de su llamada en `RouteOverviewCard`. Pedidos=blue, Paradas=red,
Distancia=lime y Tiempo planeado=amber, todos de la paleta Five existente.
Los vectores siguen sin relleno, trazo 1.7 y tamaño 16 dp; textos, tarjetas,
cantidades, navegación y acciones mantienen su implementación.
La guía UI/UX se usó para conservar los iconos y verificar contraste.

Verificación: `gradlew.bat testDebugUnitTest lintDebug assembleDebug --console=plain`.
Build aprobado en 2m32s, 103 pruebas JVM aprobadas, 0 fallos/errores/omitidas.
Lint: 0 errores y 33 advertencias existentes. Contraste con tarjeta #20242A:
azul 9.25:1, rojo 9.18:1, lima 12.70:1, dorado 10.50:1.
Este cambio no añade lógica crítica ni llamadas externas; no se amplían las
pruebas de backend ni se añaden pruebas espejo del tintado. No hay datos ficticios.
La comprobación visual física permanece pendiente: ADB muestra emulator-5554
offline. La compilación no se presenta como prueba visual.

APK develop debug 0.8.5/code27, mismo applicationId y firma de la anterior:
`.local/releases/Five-Rutas-Chofer-0.8.5-develop.apk`.
SHA-256: `012AD93A328353DED9F3E5ED4212D7DFFF120C2E8220D95E79723C76ED7A8555`.
Instalar sobre 0.8.4 conservando los datos. No requiere deploy de backend.
QA de aceptación: abrir Tu ruta y comprobar los cuatro contornos/colores,
etiquetas y valores; abrir el pedido y mapa como antes.
