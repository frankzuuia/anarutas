# Referencias — mapa, llegada y repunte

Consultadas el 24/09/2026. Resúmenes de evidencia, no código copiado ni prueba de
que la integración esté habilitada en develop.

## Google Navigation SDK Android 7.9.0

- [Eventos de navegación](https://developers.google.com/maps/documentation/navigation/android-sdk/events): callbacks de llegada, tiempo/distancia y ubicación ajustada a carretera. Esa ubicación puede diferir de la medida sin ajuste; usar esta última para presencia en domicilio. Desregistrar listeners. Llegada del SDK no equivale a recepción comercial confirmada.
- [Facturación por SKU](https://developers.google.com/maps/billing-and-pricing/sku-details#navigation-request): la solicitud de navegación se factura por destino incluido; `setDestination`/`setDestinations` son disparadores. Diseño: no volver a enviar un lote completo al corregir sólo el destino activo. Sin importe prometido ni cambio de billing realizado.
- [Configuración Android](https://developers.google.com/maps/documentation/navigation/android-sdk/android-studio-setup): Navigation incluye Maps; evitar bibliotecas duplicadas, configurar clave y avisos del SDK. Contrastar requisitos de desugaring y dependencias con el build real, no copiar ejemplos antiguos del documento.
- [Políticas y atribuciones](https://developers.google.com/maps/documentation/navigation/android-sdk/policies): preservar atribuciones/avisos y condiciones de uso al personalizar mapa/cabecera/ficha.
- [NavigationApi](https://developers.google.com/maps/documentation/navigation/android-sdk/reference/com/google/android/libraries/navigation/NavigationApi): `getNavigator(Activity, listener)` mantiene el diálogo nativo de términos cuando corresponde; no usar las variantes que omiten ese consentimiento.
- [Notas de versión](https://developers.google.com/maps/documentation/navigation/android-sdk/release-notes): 7.9.0 figura el 17/08/2026. Mantener versión fijada del repositorio; esta tarea no requiere una actualización general del SDK.

## Android

- [Permisos en runtime](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime): solicitar FINE y COARSE juntos, manejar ubicación aproximada y revocación. En algunas versiones Android 12 una solicitud FINE sola se ignora; el código auditado pide sólo FINE.
- [Tipos de permiso](https://developer.android.com/develop/sensors-and-location/location/permissions): la navegación visible requiere acceso en primer plano; no pedir rastreo permanente por conveniencia. Revisar comportamiento al salir de Activity y con guía activa.
- [Location](https://developer.android.com/reference/android/location/Location): precisión horizontal es una estimación probabilística; usar tiempo monotónico para antigüedad en el dispositivo y registrar hora del servidor en la transacción. La validación de estos campos no constituye atestación infalible.
- [Sources AGP 9.2](https://developer.android.com/reference/tools/gradle-api/9.2/com/android/build/api/variant/Sources) y [SourceDirectories.Flat](https://developer.android.com/reference/tools/gradle-api/9.2/com/android/build/api/variant/SourceDirectories.Flat): conectar assets generados por tarea y declarar su directorio de salida; no mantener una copia manual de las licencias.
- [Tareas Gradle](https://docs.gradle.org/current/userguide/implementing_custom_tasks.html): entradas y salidas anotadas para extracción reproducible. El AAR real 7.9.0 contiene `LICENSE` (2,760,092 bytes); se verificó su igualdad SHA-256 con el asset final, sin inferir nombres antiguos de los ejemplos ZIP.

## Fuentes locales inspeccionadas

Coroutines: [awaitCancellation](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/await-cancellation.html)
y [ensureActive](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/ensure-active.html).
La cancelación es cooperativa: liberar la conexión SSE bloqueante mediante un
watcher hijo y comprobar actividad antes/después de leer, no depender sólo de
que el socket termine. Prueba JVM con espera bloqueante real, sin HTTP simulado.

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`:
  métodos explícitos, params async, no caché compartida para consultas privadas.
- `src/core/route-start.ts`, `route-publications.ts`, `route-cancellation-schema.ts`,
  `route-start-guards-schema.ts`: locks, asignación, revisión y snapshot congelado.
- `src/core/driver-mobile-route.ts`, `driver-mobile-events.ts`,
  `panel-events-schema.ts`: fuente autorizada y señales transaccionales existentes.
- `src/core/customers-schema.ts`, `customers.ts`, `customers-contract.ts`:
  identidad de contacto, ventanas y versiones del cliente; autoría admin actual.
- `src/core/route-publication-content.ts`, `route-delivery-groups.ts`:
  snapshot publicado y agrupación por contacto, no por nombre comercial.
- `driver-app/app/src/main/java/com/five/anarutas/driver/RouteNavigationActivity.kt`,
  `NavigationProgress.kt`, `NavigationRegistry.kt`, `DriverApi.kt`,
  `DriverViewModel.kt`: SDK integrado, cursor local y contratos móviles actuales.

## Configuración Android autorizada — ML24

- [Configuración Navigation](https://developers.google.com/maps/documentation/navigation/android-sdk/get-api-key): proyecto, billing, habilitación y clave antes de usar el SDK.
- [Restricciones API Keys](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys): aplicar conjuntamente paquete/SHA-1 y lista de servicios desde la creación.
- [Crear clave](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys/create) y [listar claves](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys/list): identificador estable y operación consultable, listado sin valores de claves, recuperación sin duplicar.
- [Billing de un proyecto](https://docs.cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo) y [habilitar servicio](https://docs.cloud.google.com/service-usage/docs/reference/rest/v1/services/enable): lectura previa de billing y cambios exclusivamente en los dos SDK autorizados.
- [Seguridad Maps](https://developers.google.com/maps/api-security-best-practices): la clave incluida en una APK no es un secreto no extraíble; aplicar restricciones nativas de aplicación y API.
- [Gradle FileContents](https://docs.gradle.org/current/javadoc/org/gradle/api/file/FileContents.html) y [ProviderFactory](https://docs.gradle.org/current/javadoc/org/gradle/api/provider/ProviderFactory.html): archivo ausente como proveedor sin valor y prioridades explícitas. Validado contra Gradle instalado con siete casos reales.

La auditoría inicial no cambió cuentas. Tras autorización del usuario en ML24,
se usó la sesión Google existente sólo en memoria y se configuró Android en
el proyecto Maps de develop. Tokens y clave no se imprimieron. FCM, EasyPanel,
billing y producción no se modificaron; detalle verificable en el informe QA.
