# Ana Rutas Chofer — Android, bloque 1

App Android nativa para vincular automáticamente un dispositivo, entrar con teléfono y PIN,
y leer únicamente la ruta y los pedidos de la camioneta asignada. No registra
entregas, cobros, incidencias ni transferencias todavía. No llama Google Route
Optimization, Routes ni Odoo.

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
