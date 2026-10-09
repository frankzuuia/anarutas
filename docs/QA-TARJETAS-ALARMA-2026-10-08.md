# QA — tarjetas compactas y continuidad del sonido

Bloque TA aprobado por «Sí, tarjetas y alarma». Base develop `62266bb`;
repositorio Ana Rutas. Sin cambios remotos de datos, main, Five, EasyPanel,
Odoo, Google, OpenAI, APK ni despliegue. No se aplicó ui-ux-pro-max.

## Causa y corrección

La vista normal abría los detalles por defecto y apilaba campos con márgenes
grandes. Ahora ambas vistas empiezan con detalles cerrados, encabezado y datos
agrupados, comentario de hasta dos líneas y acciones compactas. Ver detalles
expone dirección, fotografías y comentario completo; no se elimina información.
Los estilos se limitan a las tarjetas del feed, sin cambiar tablas del reporte.

El botón de sonido estaba dentro de Configuración de alarma; la captura del
usuario mostraba desactivación. El último desmontaje además desactivaba el
coordinador. Ahora botón y estado están visibles; una activación válida persiste
al navegar en el mismo documento, sólo con contexto running y el mismo ámbito
instalación/administrador. Salir sigue deteniendo audio y sondeo de la vista.
Recarga y cambio de autenticación descartan el documento; no prometen autoplay.

Detener una ráfaga dejaba su reserva vigente. Se libera bajo Web Lock y sólo
si su valor aún pertenece a esa reproducción. Una nueva reserva de otra pestaña
no se elimina. Al volver se usa el cursor existente: novedades sí, repetidos no.
No se añade monitoreo sonoro en otras pantallas ni se amplía alcance servidor.

## Evidencia ejecutada

- Regresión roja contra el build anterior: `TA compact...` falló porque
  Activar sonido no era visible sin abrir Configuración. Captura/error del
  ensayo en test-results; las ejecuciones posteriores reemplazan ese directorio.
- 21 pruebas unitarias y PostgreSQL reales distintas correctas: 4 de núcleo/
  ciclo de vida y 17 de productos, organización, Excel, contratos y llegada.
- Cobertura dirigida: 95/95 líneas, 100/100 statements, 72/72 ramas y
  25/25 funciones; 100% en núcleo de notificaciones/política/esquema. El
  coordinador/JSX se comprueba con E2E, no se atribuye ese porcentaje al frontend.
- Stryker: 15/15 mutantes detectados del código técnico nuevo de activación y
  propiedad de reserva; cero sobrevivientes, timeouts o rutas sin cobertura.
- 5 E2E distintos correctos en Chrome y PostgreSQL aislado: tarjetas/continuidad,
  desconexión con 105 novedades, dos pestañas/Visto/duraciones, HTTP v3/Excel,
  y Centro de control con pantallas independientes. Pasada conjunta 2.4 min.
- El recorrido TA se amplió y repitió después: 18.9 s totales, 15.0 s del caso;
  incluye comentario largo completo, resumen máximo dos líneas, teclado Enter,
  recarga, cierre de sesión durante reproducción, GET alerts401 y nueva sesión
  desactivada. No se cambió código de aplicación después de la pasada conjunta.
- Tarjeta de devolución con foto: 122.09375 px cerrada en escritorio;
  155.890625 px en móvil390. Son medidas de esa muestra, no límites para todos
  los nombres/comentarios/dimensiones. Abrir aumenta más de50 px y muestra foto;
  cerrar recupera la tarjeta. Sin desbordamiento horizontal en móvil.
- Alarmas de10/15 s: 9,995/14,995 ms; 5 s verificados por activación y por
  novedades, sin superposición. El regreso durante la prueba inicial conserva
  activación y otra incidencia suena antes de vencer la reserva anterior.
- Propagación de la muestra compartida221 ms. No representa p95 productivo.
- Cero errores de página en el recorrido TA y las regresiones sonoras.
- Typecheck, build optimizado, lint dirigido y diff check correctos. Lint global:
  cero errores y un warning heredado de stryker.product-amendments.config.mjs.
- Auditoría productiva: cero vulnerabilidades. Auditoría completa conserva las
  mismas cinco alertas devtools ESLint/braces bajo la excepción develop ya
  autorizada por el propietario; no cambian dependencias ni lockfile.
- Complejidad ESLint medida: políticas nuevas3/1; stopSound5, sound6, poll15;
  callback principal del sondeo12. UI máximo26 (IncidentCard/BoardSection).
  El sondeo añade comprobación de identidad/capacidad; no toca reglas de negocio.

Capturas reales revisadas: `.local/qa/incident-compact/desktop.png`, mobile.png,
además de Centro de control/organización. Informes de cobertura y mutación en
reports/coverage/incident-board y reports/mutation/incident-alarm.json.

## Reproducción

```powershell
npm run build
npx vitest run --config vitest.incident-board.config.ts --coverage
npx vitest run tests/product-incidents-excel.test.ts tests/product-incident-organization.test.ts tests/product-incidents.test.ts tests/driver-incidence-schema.test.ts tests/route-incidents.test.ts
npx stryker run stryker.incident-alarm.config.mjs
npx playwright test tests/e2e/product-incidents.spec.ts tests/e2e/control-center.spec.ts --grep 'TA compact|IO reconnect|IO panel|IO v3|independent drivers' --reporter=list
npm run typecheck
npm run lint
npm audit --omit=dev --json
git diff --check
```

Los E2E levantan PostgreSQL temporal y Next en puertos locales, crean cuentas y
comandos reales y retiran su instalación. Credenciales/API externas en blanco.
No mocks ni integraciones simuladas; no se accede a datos del usuario.

## Límites y QA del propietario después de su deploy

El navegador comprueba el coordinador y Web Audio real, sin acreditar los
altavoces físicos del usuario. Activar sonido requiere gesto y permiso del
navegador; una recarga puede exigir otro gesto. Probar en Brave, con pestaña y
sistema sin silenciar: activar, navegar fuera/volver, reportar incidencia nueva,
oír la ráfaga elegida y marcar Visto desde otra sesión. Esa comprobación física
queda para el propietario, como en el bloque anterior; no se declara realizada.
No afirmar que el problema era del servidor ni modificar permisos del navegador.

Auditoría de conexiones: sólo presentación y coordinador; Excel, cuatro tipos
reportables, cantidades, clasificación, estados, fotos privadas y Visto durable
conservan sus contratos. GREEN LIGHT / INTEGRITY TOTAL / MATCH PERFECT con TA01..10.
