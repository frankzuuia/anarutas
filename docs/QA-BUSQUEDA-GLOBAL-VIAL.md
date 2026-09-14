# QA — búsqueda global geográfica multisemilla

Fecha: 2026-09-14. Alcance exclusivo: Ana Rutas `develop`.

## Autopsia y corrección

La corrida real previa conservó 60 entregas y cero tardanzas, pero recorrió
397.9 km. Las cuatro rutas tenían 15 pedidos, aunque dos unidades cruzaban zonas
ya visitadas y una regresaba a Punto Sur después de un desvío lejano. El problema
no era falta de balance ni el orden visual de las prioridades: el orquestador sólo
comparaba dos repartos y hasta tres secuencias por reparto, sin una vecindad que
intercambiara zonas ni corrigiera zigzags.

La política `priority-geographic-sequenced-v8` añade una tercera semilla de
clúster multicentro. Sus puntos completos se refinan con `relocate/swap`; cada
reparto pasa nuevamente por Google Route Optimization con precedencias por
camioneta y después genera una variante `relocate/2-opt` dentro de cada nivel de
prioridad. Todas las alternativas únicas se miden con Google Routes, incluido el
regreso a bodega, antes de comparar o guardar.

Clientes diferentes que comparten coordenada conservan `partnerId`, pedido,
tarjeta y número de parada. El mapa sólo muestra `N pedidos` si comparten cliente;
para clientes distintos muestra sus números reales. En la asignación, la visita
física exacta permanece en una sola camioneta. Si ese punto contiene prioridades
distintas, su expansión queda ordenada Alta → Media → Por horario y después por
fecha límite e identidad estable.

## Evidencia ejecutada

| Puerta                       | Resultado                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pruebas de dominio dirigidas | 2 archivos, 70/70 aprobadas                                                                                          |
| Suite completa               | 36 archivos, 382/382 aprobadas                                                                                       |
| Cobertura global             | 93.74% statements, 86.85% ramas, 97.48% funciones, 94.92% líneas                                                     |
| Planificador geográfico      | 99.7% statements, 95.37% ramas, 100% funciones y líneas                                                              |
| Mutation testing dirigido    | 95.53% total / 96.14% cubierto; 295 eliminados, 4 timeouts detectados, 12 sobrevivientes, 2 sin cobertura, 0 errores |
| TypeScript / ESLint          | Aprobados                                                                                                            |
| Build Next.js 16.3.4         | Aprobado                                                                                                             |
| E2E local                    | 1 aprobado; 2 live omitidos por no habilitar proveedores reales                                                      |
| Dependencias de runtime      | `npm audit --omit=dev`: 0 vulnerabilidades                                                                           |

Como control de volumen, la semilla multicentro procesó localmente geometrías
deterministas de 61, 100 y 500 pedidos completos en 46 ms, 79 ms y 27.8 s,
respectivamente, con cargas 15/15/15/16, 25/25/25/25 y 125/125/125/125. Es una
medición de CPU local, no un SLO de producción ni la latencia facturable de
Google. No existe corte local en 100 pedidos.

## QA posterior al deploy manual

1. Desplegar únicamente `develop` en `ana-rutas-develop/app`.
2. Pulsar **Armar ruta** otra vez en el borrador de 61 pedidos.
3. Confirmar cobertura completa de las entregas elegibles y que una ventana
   vencida produce retraso visible, no omisión ni bloqueo.
4. Comparar kilómetros, tiempo total, jornada máxima y carga contra los 397.9 km
   previos; revisar especialmente Punto Sur y los cruces norte/centro/sur.
5. Abrir el mapa y comprobar que clientes distintos en un mismo punto muestran
   números separados, permanecen consecutivos y no se dividen entre camionetas.
6. Revisar EasyPanel: semilla global, balance circular, clúster, secuenciación,
   búsqueda espacial, alternativas medidas, ganador y transacción confirmada.

La QA local no inventa el resultado de la siguiente llamada a Google. La mejora
live queda pendiente hasta el deploy y la nueva auditoría. No se modificaron Odoo,
producción, `main`, Ana V3, Luna ni listas de precios.
