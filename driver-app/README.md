# Ana Rutas Chofer — Android, bloque 1

App Android nativa para **activar un dispositivo**, entrar con teléfono y PIN,
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

## Activación

1. Administración edita al chofer, configura PIN y genera un código temporal.
2. El chofer instala la APK y escribe el origen HTTPS de Ana Rutas, teléfono,
   PIN y código. El código se consume una vez. No se infiere país del número.
3. La app guarda en Android Keystore una clave privada no exportable. El token
   de sesión se cifra con otra clave de Keystore. Ni el PIN ni el código se
   almacenan en el dispositivo.
4. Al volver a entrar, el servidor exige un desafío firmado por el celular y
   el PIN. Cambiar PIN/teléfono o revocar acceso invalida las sesiones.

Si la sesión expira, el chofer puede entrar de nuevo con el dispositivo ya
autorizado. Si pierde o cambia celular, administración debe emitir una nueva
activación. La app no guarda pedidos para modo sin conexión en este bloque.

La variable `RUTAS_DRIVER_PIN_PEPPER` debe configurarse en el servidor antes
de habilitar accesos móviles. Nunca se incluye en la APK ni en Git.
