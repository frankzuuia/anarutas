# Ana Rutas Chofer — Android, bloques 1, 2A y 2B

App Android nativa para vincular automáticamente un dispositivo, entrar con teléfono y PIN,
y leer únicamente la ruta y los pedidos de la camioneta asignada. No registra
entregas, cobros, incidencias ni transferencias todavía. No llama Google Route
Optimization, Routes ni Odoo.

El bloque 2A añade el panel de inicio del chofer: identidad, ruta exacta de hoy,
camioneta, pedidos, métricas y primera parada obtenidos del servidor, más rutas
anteriores en una sección separada. La navegación `Inicio`, `Ruta`, `Pedidos` y
`Perfil` abre pantallas reales; sus acciones no ejecutan entregas ficticias.
Distancias, tiempos y horarios son previsiones guardadas, no progreso real del
chofer. Si falta una optimización vigente se muestra su ausencia.

El bloque 2B añade publicación explícita por camioneta, fotos privadas de la
unidad (WebP, máximo ocho, eliminación a los 15 días) y el inicio de ruta tras
cinco fotos distintas. `Inicio` y `Ruta` muestran sólo el snapshot publicado.
Las tarjetas de paradas y pedidos abren su detalle. Después de iniciar, el
acceso compacto `Mapa` queda en el centro de la barra inferior. Usa el
Navigation SDK oficial: el mapa y los giros no son simulaciones. Abrir el mapa
dibuja sólo el trazo publicado previamente calculado, cuando existe, y no solicita
un recorrido nuevo; `Iniciar guía` sí puede generar una solicitud
facturable. Para más de 25 paradas, se solicita el siguiente bloque únicamente
cuando el chofer lo decide. La navegación no marca pedidos como entregados.

## Compilación

Requiere JDK 17, Android SDK API 37, Build Tools 36.0.0 y Gradle 9.4.1. Las
versiones se eligen conforme a la compatibilidad publicada para Android
Gradle Plugin 9.2.0. El SDK se instala fuera del repositorio; no se agrega
`local.properties`, `.gradle` ni `build/` a Git.

En `driver-app/`, con `JAVA_HOME` y `ANDROID_HOME` configurados:

```powershell
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
```

La APK de depuración quedará en `app/build/outputs/apk/debug/`. Requiere
prueba en Android real antes de distribución. No utilizar esta APK de debug
como firma de producción.

## Configuración de fotos y mapa antes de probar 2B

- En EasyPanel develop, montar un volumen persistente **privado** en una ruta
  absoluta del contenedor, sin exposición web, y configurar
  `RUTAS_UNIT_PHOTO_DIR` con esa ruta. Sin el volumen, la captura y el inicio
  fallan cerrados; no se guardan fotos en PostgreSQL/base64. El worker borra
  metadatos y archivos al vencer 15 días; los respaldos del volumen deben
  respetar también esa retención.
- Habilitar Navigation SDK y su facturación en el proyecto de Google Maps.
  Crear una clave Android restringida al paquete
  `com.five.anarutas.driver` y la huella SHA-1 del certificado que firma la
  APK que se instalará. Una clave de servidor para Routes **no** sustituye
  esta clave. Inyectarla fuera de Git, por ejemplo como variable local
  `ORG_GRADLE_PROJECT_ANA_RUTAS_NAVIGATION_API_KEY` al compilar.
- Si la clave falta, la APK compila y muestra un aviso en Ruta, pero no ofrece
  el botón de mapa. Si el GPS o la cuota falla, el SDK devuelve error y no se
  inventa una instrucción de giro. Se requiere prueba física con datos reales
  antes de distribuir.
- Antes de distribuir, completar los avisos legales y licencias exigidos por
  Navigation SDK (`NOTICE.txt` y `LICENSES.txt` de su distribución) y verificar
  en dispositivo el diálogo de términos de Google y las advertencias al chofer
  sobre condiciones reales de la vía y costos de peaje. Este bloque aún no
  certifica ese requisito de distribución.

## Acceso

1. Administración edita al chofer y configura un PIN de cuatro dígitos.
2. El chofer instala la APK y escribe únicamente su teléfono mexicano de diez
   dígitos y el PIN. El origen HTTPS se fija durante la compilación mediante
   `ANA_RUTAS_SERVER_URL`; el chofer no puede modificarlo.
3. La app guarda en Android Keystore una clave privada no exportable. El token
   de sesión se cifra con otra clave de Keystore. El primer acceso registra
   internamente la clave pública. El PIN no se almacena en el dispositivo.
4. Al volver a entrar, el servidor exige un desafío firmado por el celular y
   el PIN. Cambiar PIN/teléfono o revocar acceso invalida las sesiones.

Si la sesión expira, el chofer puede entrar de nuevo con el dispositivo ya
registrado. Si pierde o cambia celular, entra con teléfono y PIN y el nuevo
dispositivo se registra automáticamente. Tras cambiar el PIN en administración,
el siguiente acceso vuelve a vincular el celular sin pedir otro dato.
Administración puede revocar todos
los dispositivos desde la ficha del chofer. La app no guarda pedidos para modo
sin conexión en este bloque.

La variable `RUTAS_DRIVER_PIN_PEPPER` debe configurarse en el servidor antes
de habilitar accesos móviles. Nunca se incluye en la APK ni en Git.
