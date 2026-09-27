# QA — mapa prioritario y camioneta compacta

BL-136 / CC17a..e. 26/09/2026. Base `dafef54`, develop. Sólo Ana Rutas.
Sin esquema, cambios Android, permisos nuevos, endpoints nuevos ni Deploy.

## Diagnóstico y cambios

- Tarjetas estrechas forzaban mapa de 320 px con lista debajo, aunque sólo
  quedaban ~130 px visibles. Se elimina esa altura mínima/scroll del mapa,
  compactan encabezado y único filtro Chofer; avance es desplegable superpuesto.
- `button.quiet` posterior anulaba el fondo. Mayor especificidad acotada al
  mapa asegura fondo opaco también deshabilitado, contraste y tooltip de causa.
- Se ignora vehicleId heredado en presentación y se limpia al cambiar chofer;
  contrato de preferencias compatible, persistencia CAS sin modificaciones.
- Camioneta SVG local del mismo sistema de iconos, círculo 38×38 px, sin
  nombre visible (aria-label conserva identidad). Gris para señal antigua o
  detenida. Texto mediante textContent, sin HTML proporcionado por datos.
- La primera muestra puede llegar tras el encuadre inicial. La clave de
  encuadre cambia por presencia de GPS, ruta/filtro, Centrar o tamaño, no por
  cada muestra. Seguir centra ubicación; consultar parada suspende seguimiento
  mientras está seleccionada; Centrar vuelve al conjunto.
- Usuario confirmó que el teléfono tenía APK anterior y que con 0.7.0 apareció
  el GPS. No se cambia el servicio ni se finge una ubicación a partir de pedidos.

## Comandos reproducibles

```powershell
npm run build
npm run typecheck
npm run lint
npx vitest run tests/live-route-presentation.test.ts tests/live-tracking.test.ts --coverage --coverage.include=src/core/live-route-presentation.ts --coverage.thresholds.lines=100 --coverage.thresholds.branches=100 --coverage.thresholds.functions=100 --coverage.thresholds.statements=100
npx stryker run stryker.live-route-presentation.config.mjs
npx playwright test tests/e2e/control-center.spec.ts
npx eslint src/core/live-route-presentation.ts src/components/live-map-marker.ts --rule 'complexity: [warn, 8]'
npm audit --omit=dev
git diff --check
```

## Evidencia y métricas

- 20 pruebas unitarias/PostgreSQL reales verdes (12 presentación, 8 contratos
  previos GPS/preferencias). Sin mocks de API, base, sensores o Google.
- Cobertura dirigida de política: 6/6 líneas, 9/9 statements, 5/5 funciones y
  12/12 ramas, 100%. Objetivo 100% por estado GPS y estabilidad de encuadre;
  no equivale a cobertura global ni a cobertura de Maps/React.
- Mutation: 42/42 killed, cero supervivientes, no cubiertos, timeouts o errores.
  Umbral 100%. Reporte `reports/mutation/live-route-presentation.json`.
- 3 E2E verdes en 25.7 s sobre servidor Next compilado y PG aislado. Incluyen
  HTTP 401/409, origen ajeno 403, permisos, persistencia, preferencias heredadas,
  cuatro mapas, foco/Enter/Escape, fullscreen, móvil, todas las secciones,
  independencia de filtros y marcado DOM real de camioneta/parada.
- Geometría cuatro tarjetas: mapa 234.25 px / 75.02% de tarjeta a 1500×800;
  218.25 px / 73.67% a 1366×768. Cero recorte por scroll, canvas=alto del mapa;
  cuatro tarjetas enteras y cero scroll de página. Umbral >=70% y >=190 px.
- Controles deshabilitados: fondo RGB(38,60,48), texto RGB(185,201,191), opacidad
  1. Camioneta 38×38, radio 50%, vector visible, nombre oculto, color gris al
  caducar. Constructor de producción cargado en navegador sin sustituir Maps.
- Latencia HTTP local escritura GPS→lectura admin: 529 ms, incluida sesión
  administrativa; no representa latencia celular ni certifica SLO físico.
- Build, typecheck y lint verdes. Complejidad de funciones nuevas <=8 según
  ESLint. npm audit producción: cero vulnerabilidades informadas; sin cambios
  de dependencias. Cero errores React en recorrido principal.
- Primer pase del test DOM leyó el color gris antes de terminar la transición
  CSS de 150 ms. Se corrigió la sincronización del test esperando las animaciones
  reales, sin sleeps arbitrarios ni modificar el comportamiento de producción.
- Captura revisada: `.local/qa/control-center/map-first-four.png`.

## Límites y prueba de aceptación tras Deploy

El E2E local usa instalación sin clave Maps: prueba el fallback real, geometría,
constructor DOM y estilos, NO tiles/AdvancedMarkerElement/fitBounds del proveedor.
El usuario ya verificó llegada de GPS real con APK 0.7.0; falta observar el nuevo
aspecto desplegado. Sigue aplicando la excepción de publicación a develop para
pruebas CC-PUB-AUTH, no certificación de producción ni permiso de Deploy.

Después del Deploy manual, con la misma APK 0.7.0:

1. Abrir cuatro rutas y elegir chofer independiente. Mapas completos, sin
   Camioneta; controles Centrar/Seguir legibles sobre calles claras.
2. Comprobar icono de camioneta sin nombre visible. Consultar avance/paradas,
   cerrar, ampliar y reducir; datos/filtro no desaparecen.
3. Abrir sin muestra y luego abrir la app móvil: primer GPS entra al encuadre.
   Zoom manual permanece en siguientes muestras; Seguir recorre GPS y Centrar
   vuelve al conjunto. Selector compacto conserva vista Mapa/Satélite.
4. Detener seguimiento: último punto queda gris y muestra antigüedad/detenido,
   nunca se mueve artificialmente a un pedido. Reanudar recupera GPS real.

Rollback: revertir sólo este cambio de UI/política de presentación; no borrar
preferencias, telemetría, publicaciones ni datos. Main y base desplegada intactos.

## Seguimiento BL-137 / CC18 — resumen junto al logo

Se sustituye la posición absoluta 27 px arriba por un control nativo
`map.controls[ControlPosition.BOTTOM_LEFT]`, documentado a la derecha del logo.
Un portal React mantiene las cifras/GPS actualizados dentro de un host estable;
cleanup retira sólo su índice actual, no otros controles. No se modifica DOM de
Google, atribuciones, cámara, autorización o captura GPS. Resumen compacto de
22 px cuando cabe una fila. En instalación sin Maps queda a 3 px del fondo;
Avance de rutas mantiene su resumen fuera del mapa.

Referencias oficiales:
https://developers.google.com/maps/documentation/javascript/controls
https://developers.google.com/maps/documentation/javascript/policies
Tipos instalados: `ControlPosition.BOTTOM_LEFT` en `@types/google.maps`.

Validación repetida: build con TypeScript, lint, 12 pruebas de política con
100% cobertura dirigida y 42/42 mutantes detectados. E2E ampliado a posición del
resumen, fila <=22 px en cuatro tarjetas, sin overflow a 390 px, cifras tras
cambiar chofer, una instancia del resumen y fullscreen. No hay nueva lógica de
dominio que mutar; esas 42 mutaciones son regresión de la política existente,
no cobertura del portal ni del SDK Google. No cambian dependencias ni APIs.
Pase final: 3 E2E verdes en 23.2 s; escritura/lectura HTTP local 427 ms.
Mapas conservan 234.25/218.25 px de alto; resumen fallback 22 px de alto,
separado 3 px del borde a 1500×800 y 1366×768, sin overflow a 390 px.
El primer lint rechazó asignar className al host guardado en estado; la clase
se asigna al crear el elemento, antes de entregarlo a React/Google.

Límite: E2E valida el fallback real sin clave. La disposición exacta del control
Google junto a logo/créditos requiere comprobarse tras Deploy en 2×2 y pantalla
completa, incluido ancho estrecho. Mantener la excepción de pruebas develop,
no declararlo certificado en Maps real por un test que no carga ese SDK.
