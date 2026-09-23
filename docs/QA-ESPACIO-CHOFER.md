# QA — Espacio del chofer / Five Rutas 0.3.0

## Alcance y decisión

BL-101, UX01..08. Rediseño nativo Compose: Inicio de cuatro tarjetas, drawer,
barra inferior de iconos, Ruta, Pedidos con búsqueda local, Mi unidad, Mis rutas,
Perfil, Preferencias y diálogos compartidos. Logo original de Five incorporado
desde el archivo existente de la marca; recurso local y launcher adaptativo.
No se modificaron Next, SQL, permisos del servidor, Odoo ni cálculos de Google.
No se usó ui-ux-pro-max. La revisión de arquitectura separó presentación, estado
y política de salida antes de implementar; no se añadieron módulos ficticios.

El usuario decidió explícitamente probar la APK él mismo y no habilitar ADB en
BlueStacks. Por ello la entrega es una **APK de desarrollo para prueba manual**,
no una certificación visual o de distribución productiva. No se modificó la
configuración de BlueStacks. Los E2E Android quedan preparados, no ejecutados.

## Comandos reproducibles

En `driver-app`, JDK 17 y Android SDK configurados externamente:

```powershell
.\gradlew.bat testDebugUnitTest createDebugUnitTestCoverageReport assembleDebug assembleDebugAndroidTest lintDebug
.\scripts\verify-workspace-mutations.ps1
```

El script de mutación copia sólo el proyecto Android a una carpeta temporal,
verifica un baseline y ejecuta ocho cambios incorrectos independientes. Nunca
modifica el checkout. El resultado y los informes JUnit se guardan en esa copia.

En raíz, regresiones de contrato con PostgreSQL temporal real:

```powershell
npx vitest run tests/route-publications.test.ts tests/driver-mobile.test.ts
```

Para E2E Android futuros, dispositivo autorizado con la app vinculada mediante
su acceso real y datos de develop. Las pruebas no siembran datos, no simulan HTTP,
no inician rutas ni borran fotos:

```powershell
.\gradlew.bat connectedDebugAndroidTest
```

## Evidencia y métricas

- Unitarias Android: 25 casos sin fallos; incluye los 18 anteriores.
- Integración PostgreSQL: 20/20 casos, 33.33 s. E2E HTTP/panel: 2/2 casos,
  41.7 s; publicación, autenticación, aislamiento, fotos, cancelación y revocación.
  Inicio visible en el panel en 245 ms en esta ejecución local (no es un SLO de red móvil).
- `DriverDashboardPolicy.kt`: 54/54 líneas (100 %), 70/73 ramas (95.89 %).
  Objetivo por riesgo: 100 % de líneas de la política de salida/selección/búsqueda
  y todos los escenarios críticos. No equivale a cobertura visual de Compose.
- Cobertura JVM global Android: 209/2002 líneas (10.44 %), incluyendo Activity,
  API, Compose y SDK no ejecutados en JVM. Se reporta separada; no se presenta el
  100 % de la política como cobertura total. E2E Android/visual: pendientes por
  decisión explícita del usuario de probar la APK manualmente.
- Mutación dirigida: **8/8 detectados**, cero sobrevivientes. Fecha anterior,
  ruta iniciada, cuatro fotos, ruta vacía, recorrido obsoleto, selección histórica
  usada para el mapa, búsqueda sin trim y búsqueda sensible a mayúsculas.
- Complejidad ciclomática máxima de la política: 6 (`canStartRoute`), medida por
  JaCoCo; sin fallos unitarios ni de contrato en los escenarios ejecutados.
- Evidencia de mutación: `ana-rutas-workspace-mutations-848c8328901549f2accfd504449a3eeb`
  en la carpeta temporal del usuario, con `results.json` y logs independientes.
- APK y APK de instrumentación: compilación correcta de ambas.
- Android Lint: cero errores y 19 advertencias locales; las advertencias de
  dependencias/SDK no se ocultan ni justifican actualizar librerías sin alcance.
- Latencia de navegación, fluidez, tamaños de fuente y consumo de batería:
  pendientes de medición en dispositivo, no se inventan cifras. Búsqueda/listas
  son locales y virtualizadas. No crean llamadas a Google u Odoo.
- Sin nuevos permisos, endpoints, dependencias ni secretos. Sesión cifrada y
  claves Keystore conservadas. Preferencias visuales separadas de credenciales.
- Errores de red: reintento explícito y actualización manual conservan el destino;
  el refresco de fondo conserva la política existente de consulta cada 30 s visible.
- Navegación Google: requiere la clave Android existente; esta entrega no la
  configura ni certifica navegación en calle. No hay instrucciones simuladas.

## Revisión manual acordada con el usuario

1. Actualizar la APK sobre la anterior sin desinstalar. Confirmar versión 0.3.0,
   icono Five, sesión conservada, logo en acceso/cabecera/drawer.
2. En Inicio comprobar nombre/fecha, las cuatro tarjetas, estados sin ruta y
   textos largos. Probar pantalla pequeña, orientación y fuente ampliada.
3. Abrir/cerrar menú, usar Atrás y barra inferior. Abrir Mis rutas y volver a hoy.
4. Revisar métricas/horarios del snapshot. Abrir un pedido desde Ruta y Pedidos;
   buscar por cliente/folio/dirección y limpiar búsqueda.
5. Abrir fotos. Antes del inicio tomar/eliminar con confirmación y comprobar
   conteo; con cuatro fotos el inicio permanece deshabilitado. Probar captura
   cancelada, cámara no disponible, error de red y reintento de miniatura.
6. Con cinco fotos abrir confirmación y cancelarla: no debe iniciar. Confirmar
   cuando proceda, revisar bloqueo de fotos e inicio visible en el panel.
7. Consultar ruta anterior: cámara/inicio no disponibles. Cancelación desde
   administración y cambio de fecha retiran la ruta/fotos obsoletas sin logout.
8. Activar Preferencias, cerrar/reabrir y verificar persistencia. Pantalla activa
   sólo durante ruta iniciada; Ajustes abre permisos reales de Android.

La aprobación de estos pasos sigue pendiente del usuario. No se tocó producción
ni EasyPanel. Al cambiar sólo la APK, no se necesita Deploy ni Rebuild del panel.

## Artefacto entregado

`Five-Rutas-Chofer-0.3.0-develop.apk`, paquete `com.five.anarutas.driver`, code 8,
67,487,583 bytes. Firma APK v2 validada con `apksigner verify --verbose`.
SHA-256: `d080e516d41e09de2cb3f81f56c161a755b063e6eb9077ead2ba373cd5b86813`.
Ubicación local: `.local/releases/`. Firma de desarrollo, no distribución final.
Actualizar sobre la instalación previa, sin desinstalar ni borrar datos.
