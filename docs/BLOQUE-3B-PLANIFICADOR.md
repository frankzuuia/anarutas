# Planificador compacto, mapa y notas

Solicitud: aprovechar pantalla, menú plegable, borradores compactos, siete camionetas,
scroll independiente, mapa de entregas y notas picker sin modificar Five/V3/Luna.

## Contratos

- Escritorio: altura de viewport; controles superiores y cabeceras visibles. Cada
  lista tiene scroll vertical propio; las camionetas adicionales se recorren
  horizontalmente sin comprimir sus tarjetas hasta hacerlas ilegibles.
- Selector de borradores sustituye la columna lateral. Nuevo borrador abre el mismo
  formulario y mantiene API, idempotencia y versión. Menú con aria-expanded.
- La barra de trabajo agrupa título, selector, zona horaria, alta y actualización en
  una sola fila. Fecha y nombre del plan comparten encabezado; el formulario de alta
  sólo ocupa espacio mientras su modal está abierto. Confirmaciones son flotantes y
  se retiran automáticamente, por lo que no desplazan pedidos ni camionetas.
- En escritorio de 768 px de alto el inicio de las columnas queda antes de 180 px y
  se muestran al menos seis tarjetas completas cerradas, cada una de hasta 80 px.
  Abrir una tarjeta puede hacerla crecer deliberadamente; el desplazamiento continúa
  aislado dentro de su lista.
- Las tarjetas aplican divulgación progresiva. Cerradas enseñan únicamente número de
  parada, cliente, pedido, cantidad de partidas, horario y prioridad. Al expandir
  conservan dirección, referencia de surtido, promesa, productos, notas picker,
  selector de camioneta y controles de orden. En puntero preciso esos controles bajan
  a 28 px; móvil y dispositivos táctiles conservan objetivos de 44 px.
- Añadir camioneta vive en la barra de acciones y usa
  `POST /api/plans/[id]/vehicles`. La operación es aditiva: valida versión, disponibilidad
  y chofer activo dentro de una transacción, agrega sólo unidades nuevas y audita el
  resultado. No elimina carriles, no desasigna pedidos y no consulta Odoo. El modal
  excluye las unidades ya presentes, bloquea las no disponibles, admite selección
  múltiple y explica cuando no quedan opciones elegibles.
- Cada carril de camioneta muestra un bote rojo con nombre accesible y confirmación
  previa. `DELETE /api/plans/[id]/vehicles` bloquea la versión del borrador,
  regresa a `vehicle_id = null` todos los pedidos de ese carril, elimina únicamente
  la relación de la camioneta con el plan, incrementa versión y audita la cantidad
  desasignada dentro de una transacción. La unidad sigue en la flota y no se consulta
  ni modifica Odoo. Cancelar o Escape no escribe y restaura el foco al disparador.
- Mapa modal de pantalla completa, Escape, foco restaurado, filtros por camioneta,
  números de parada y agrupación visual de pedidos en coordenadas idénticas.
  Direcciones vacías, ambiguas y fallidas se señalan sin inventar coordenadas.
  Los puntos no afirman ser recorridos viales optimizados. Sin polilíneas inventadas.
- GET /api/maps/config autenticado, privado y no-store. Sólo publica una clave
  explícita de navegador y map ID de runtime. Sin fallback a secretos del servidor.
- Configurar RUTAS_GOOGLE_MAPS_BROWSER_KEY restringida al dominio y a Maps JavaScript
  API/Geocoding API, y RUTAS_GOOGLE_MAP_ID. Facturación/API habilitadas por el propietario.
  Sin configuración, modal informa mapa pendiente sin cargar scripts ni enviar direcciones.
- Google recibe sólo las direcciones para geocodificación. Resultados efímeros en memoria
  del modal, una consulta por dirección única; cierre detiene la cola pendiente.
- Notas: leído el QR existente (sin editarlo): note de cada producto se escribe en
  sale.order.line mediante campo Studio certificado por etiqueta Nota para picker.
  Ana Rutas descubre esa etiqueta exacta o valida ODOO_SALE_ORDER_LINE_PICKER_NOTE_FIELD.
  No campo: no inventa nota. Dos campos: falla explícitamente. char/text solamente.
  Snapshot mantiene pickerNote opcional; React lo escapa y aparece bajo producto.
  Snapshots anteriores siguen válidos. Una recarga no sobrescribe cambios detectados
  en snapshots existentes: permanecen señalados para revisión conforme al contrato 3A.
- Ventanas y prioridad existentes siguen en DB/contrato y se muestran también en mapa.
  La carga del archivo de preferencias y la optimización corresponden a su siguiente bloque.

## Dependencias verificadas

El usuario confirmó que aún no tiene Google configurado. No se certifica integración
Google live ni se activa facturación en este bloque. La lectura real vegetables3 dio
7 pedidos/27 partidas/0 notas; fields_get no encontró Nota para picker en sus líneas.
No se modificó Odoo ni el flujo que escribe cotizaciones/QR.

## Referencias oficiales

- https://developers.google.com/maps/documentation/javascript/load-maps-js-api
- https://developers.google.com/maps/documentation/javascript/content-security-policy
- https://developers.google.com/maps/documentation/javascript/geocoding
- https://developers.google.com/maps/documentation/javascript/advanced-markers/overview

## QA reproducible

`npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:coverage`,
`npx stryker run stryker.planner.config.mjs`,
`npm run test:mutation:vehicle-removal`, `npm run test:e2e`.
E2E usa PostgreSQL real y navegador; no simula Google. Escenarios de 7 camionetas y
25 pedidos, tamaños 375/768/1024/1440/1920, scroll local, menú, notas escapadas,
modal sin configuración, autenticación, concurrencia y regresión de flota/cuentas.
La prueba de densidad usa 768 px de alto, exige documento sin scroll, columnas antes
de 180 px, más de 250 px útiles por carril, al menos seis pedidos completos visibles
y tarjetas cerradas de hasta 80 px. También abre y cierra una tarjeta real y verifica
dirección, productos, nota picker escapada y reasignación mediante el contrato existente.

Activación Google pendiente: configurar claves propias; probar puntos, permiso denegado,
dirección ambigua, duplicadas, filtros, cierre y reapertura, CSP y cuota con Google real.

## Evidencia de ejecución 2026-09-09

- 101 pruebas / 11 archivos verdes. Cobertura core: statements 96.08%, branches
  91.96%, funciones 96.72%, líneas 97.43%. Adaptador Odoo validado live y por AST.
- Mutación de notas y configuración pública: 87 eliminados / 87, 100%, sin sobrevivientes.
- Mutación del retiro transaccional: 20 eliminados / 20, 100%, sin sobrevivientes.
- Build Next, tipos y lint verdes. npm audit de dependencias productivas: 0 vulnerabilidades.
- E2E navegador + PostgreSQL: 1 recorrido completo verde, 22.3 s incluyendo arranque.
  Capturas reports/screenshots/planner-seven-{768,1024,1440,1920}.png y móvil 375.
- Tercera pasada de densidad: las tarjetas cerradas usan divulgación progresiva y
  miden menos de 80 px en la prueba de 768 px. Resultado: 8 visibles en las capturas
  de 768 y 1440 px, conservando todos los detalles y controles al expandir.
- Regresión real detectada y corregida: etiquetas sr-only absolutas causaban overflow
  del documento; se contienen en la lista con position:relative, conservando accesibilidad.
- Lectura Odoo real posterior al cambio: 7 pedidos, 27 partidas, 0 notas. Sin escrituras.
- Google live sigue pendiente, explícitamente separado de las puertas locales aprobadas.
