# Ana Rutas Chofer — Android, bloques 1, 2A y 2B

## Mapa, llegada y repunte — 0.5.1 (validación local)

Tras iniciar se abre el mapa de la ejecución propia, con todos sus puntos,
posición GPS precisa y ficha inferior Five. «Llegué» se valida otra vez en el
servidor y abre los productos reales: no completa una entrega. «Mal punteado»
permite arrastrar el pin o usar el GPS, confirma cerca del nuevo domicilio y
actualiza el cliente para futuras rutas. Registra incidencia consultable por
fecha y chofer; conserva los snapshots y orden de otras camionetas.

La ficha inferior puede bajarse para ver casi todo el mapa; tocar un marcador
abre la información de esa parada. Si hay varios pedidos en ella se consulta uno
a la vez con un selector. El icono de voz silencia o reactiva la
guía y conserva la preferencia. «Llegué» y «Confirmar punto» mantienen una muestra
GPS válida reciente durante breves variaciones de precisión; el servidor vuelve
a verificarla al guardar. Durante el arrastre el botón de confirmación queda
inactivo hasta soltar el pin. Tras confirmar el nuevo pin se abre un modal para
capturar calle y número, colonia, código postal y ciudad. Sólo la confirmación
final envía punto y domicilio juntos; si cierra el modal no se guarda nada.
La dirección confirmada se guarda en el cliente, la parada, el pedido móvil y
la incidencia; no se adivina una dirección desde las coordenadas.

El radio inicial es 100 m, precisión máxima 50 m y antigüedad 30 s; administración
puede cambiarlo en Incidencias → Reglas de llegada. La incertidumbre GPS se suma
a la distancia, no al radio. Sin señal reciente, permiso preciso, sesión/ruta
vigente o conexión confirmada, no se registra un éxito ficticio.

La guía solicita un destino explícito, no lotes de paradas. GPS, repunte previo,
refresco e incidencias no llaman Routes/Fleet. Si hubo corrección, las métricas
publicadas se identifican como originales; no se dibuja el trazo anterior como
vigente. Las confirmaciones ambiguas se cifran por ruta y se reintentan con la
misma clave. El canal se cierra al abandonar su pantalla.

Esta versión requiere **backend con esquema 20 antes de instalar la APK**.
La clave Android restringida ya está configurada localmente para develop;
términos nativos Google y prueba física siguen pendientes. No es autorización de Deploy ni certificación
de navegación real. Ver `docs/QA-MAPA-LLEGADA-REPUNTE.md` en la raíz.

## Espacio del chofer — 0.3.0

Inicio con tarjetas Ruta activa, Pedidos, Mi unidad y Mis rutas; logo original
Five, tema grafito/lima, iconos locales y menú lateral. Las listas de paradas y
pedidos son virtualizadas. Búsqueda local por cliente, folio y dirección, detalle
real y fotos mantienen sus contratos existentes. Rutas de otra fecha sólo son
de consulta. El acceso central al mapa siempre abre la ruta iniciada de hoy.

Preferencias guarda sólo la opción local de pantalla activa durante una ruta;
la gestión de permisos abre Ajustes Android. No cambia permisos del servidor.
La actualización manual conserva la pantalla actual y muestra errores de red.
La sesión sigue protegida por Keystore. QA: `docs/QA-ESPACIO-CHOFER.md` en raíz.
Actualizar esta APK no requiere Deploy/Rebuild del backend.

App Android nativa para vincular automáticamente un dispositivo, entrar con teléfono y PIN,
y leer únicamente la ruta y los pedidos de la camioneta asignada. No registra
entregas completadas, cobros ni transferencias. No llama Google Route
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
facturable para el destino seleccionado. La navegación no marca pedidos como entregados.

## Actualización automática de rutas

Mientras la APK está abierta, el servidor avisa de publicaciones y retiros por
un canal móvil autenticado. La app relee su dashboard y muestra la ruta nueva o
actualizada sin tocar «Actualizar»; la consulta periódica sigue como respaldo
si se corta el canal. El evento no contiene pedidos ni datos personales y no
solicita cálculos de Google/Odoo. Con la APK cerrada Android no mantiene ese
canal: Firebase Cloud Messaging integrado desde 0.4.0 avisa de publicación y
cancelación con permiso del usuario; las credenciales de servidor permanecen
fuera del repositorio. No se instala un servicio permanente en segundo plano.

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
- Alternativa local automática: `navigation.local.properties` en `driver-app/`,
  excluido de Git, contiene `ANA_RUTAS_NAVIGATION_API_KEY` y el origen asociado
  `ANA_RUTAS_SERVER_URL`. Las propiedades explícitas Gradle tienen prioridad;
  una clave explícita vacía desactiva navegación. Si el origen local no coincide
  con el servidor de la compilación, falla en lugar de reutilizar otra clave.
  La configuración de develop quedó protegida por ACL. No copiar ese archivo
  a producción, logs ni respaldos públicos. Una clave Android sigue contenida
  en la APK: la protección efectiva son sus restricciones de API/paquete/firma.
  Verificar con `.\scripts\verify-navigation-config.ps1`; no llama Google ni ADB.
- Si la clave falta, la APK compila y la pantalla operativa explica que el mapa
  aún no está disponible. Si el GPS o la cuota falla, el SDK devuelve error y no se
  inventa una instrucción de giro. Se requiere prueba física con datos reales
  antes de distribuir.
- El build extrae los archivos legales originales del mismo AAR Navigation que
  se compila; en 7.9.0 el archivo presente es `LICENSE`. Si falta la licencia,
  falla el build. Menú → Avisos y licencias permite leer el texto completo sin
  conexión. El aviso de seguridad requiere confirmación explícita versionada;
  no acepta ni sustituye los términos nativos de Google.
- Antes de distribuir, verificar en dispositivo el diálogo de términos de
  Google, atribuciones visibles y advertencias sobre condiciones reales de la
  vía y costos de peaje. Compilar y empaquetar la licencia no certifica ese QA.

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
