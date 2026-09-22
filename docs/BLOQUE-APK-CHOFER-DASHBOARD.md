# Bloque 2A — dashboard premium del chofer

## Alcance aprobado

El inicio móvil presenta exclusivamente datos reales ya guardados para el chofer
autenticado. No ejecuta Google Route Optimization, Google Routes ni operaciones de
Odoo. Tampoco crea estados operativos que todavía no existen.

## Contrato

- La fecha de trabajo procede de `RUTAS_TIMEZONE` en el servidor, no del reloj del celular.
- La ruta de hoy se identifica por fecha exacta y autorización vigente del chofer.
- Identidad, camioneta, placa, pedidos, secuencia, ETA y métricas proceden de PostgreSQL.
- Distancia, duración, salida y regreso se etiquetan como planeados; si el cálculo no está
  vigente se muestra `Pendiente` o el estado real correspondiente.
- Las rutas anteriores permanecen separadas como historial y nunca se promueven a ruta de hoy.
- Si la camioneta no tiene pedidos, la ruta se marca vacía sin afirmar que existe un
  recorrido calculado para esa unidad.

## Navegación funcional

- `Inicio`: resumen real de hoy, primera parada e historial.
- `Ruta`: secuencia guardada y resumen del recorrido seleccionado.
- `Pedidos`: detalle real de productos por pedido.
- `Perfil`: identidad móvil y cierre real de sesión.

No se incluyen botones para `Llegué`, cobro, devolución, incidencia, transferencia o
navegación en vivo hasta implementar sus eventos de servidor, idempotencia, recepción
offline y pruebas de autorización.

## Puertas

1. Unitarias de selección de fecha, formato y estados faltantes.
2. Integración PostgreSQL real del dashboard y aislamiento por chofer.
3. Contrato HTTP autenticado de `/api/mobile/dashboard`.
4. Compilación y pruebas unitarias Android.
5. Typecheck, lint, pruebas backend y build web.
6. Revisión manual de contraste, targets táctiles y ausencia de acciones decorativas.

## Evidencia local de QA — 21–22/09/2026

- `npm run typecheck`, `npm run lint`, `npm run build`: verdes.
- `npm run test:coverage`: 462/462 en 42 archivos; 95.71 % líneas globales,
  87.87 % ramas y 98.02 % funciones. En `driver-mobile-route.ts`: 95.45 %
  líneas y 63.15 % ramas. La regresión de ruta vacía quedó incluida.
- `npx playwright test tests/e2e/driver-mobile.spec.ts`: 2/2 con HTTP y
  PostgreSQL reales, sin Odoo ni Google. Build regenerado antes de la prueba.
- `driver-app/gradlew.bat clean test assembleDebug`: verde, 10/10 unitarias
  Android. `driver-app/gradlew.bat lintDebug`: verde.
- Mutación móvil completa dirigida a cuatro archivos: 91.30 % global,
  147 mutantes muertos, 6 sobrevivientes y 8 sin cobertura; los mutantes
  nuevos de fecha/estado vacío fueron detectados. La suite permanente de
  autenticación vuelve a su alcance original. La suite aislada
  `npm run test:mutation:driver-dashboard` obtuvo 85.71 %: 12 mutantes
  muertos, 0 sobrevivientes y 2 sin cobertura. No se afirma cobertura total
  de mutación del módulo de rutas.
- Revisión DeepSeek V4.1 Flash mediante DeepAstra, una llamada real sólo lectura
  y revisión independiente de Codex: corregido el falso error durante carga;
  descartado el caso de placa `NULL` porque el esquema exige `NOT NULL`.
- Sin emulador ni teléfono Android conectado a esta estación: compilación y
  unitarias son evidencia local, pero QA visual táctil en dispositivo físico
  queda pendiente antes de distribución operativa.

## Entrega y secuencia de prueba

El APK local es `Ana-Rutas-Chofer-v0.2.0-develop.apk` (versionCode 3), con el
mismo identificador y certificado de desarrollo que la versión anterior. El
servidor de `develop` debe contener primero `/api/mobile/dashboard`; si se
instala el APK contra un despliegue anterior, el panel no puede cargar. No se
ha hecho commit, push ni despliegue como parte de este bloque.
