# BL-189 — menú lateral móvil, aprobado 2026-10-01

El propietario confirmó un menú lateral izquierdo cerrado al entrar, opciones
en lista y apertura desde ☰. Cierre al seleccionar, tocar fuera, X o Escape;
foco accesible y contenido inmóvil. Verificar móvil, cambio de tamaño y escritorio,
conservar permisos/funciones y entregar a develop. Sin APK ni despliegue.

## Autopsia y diseño conectado

`Dashboard` inicia `menuClosed=false`. A 720px, `globals.css` cambia `.app` a
block, mantiene sidebar en el flujo y convierte `.nav` a flex-wrap. Por eso el
menú queda encima de la pantalla en varias columnas.

Mantener el sidebar/toggle de escritorio. En móvil ocultarlo por CSS y usar un
trigger propio accesible, con estado inicial cerrado, independiente del estado
del menú desktop. Un componente de diálogo lateral reutiliza exactamente el
mismo contenido de navegación, los mismos destinos y las mismas restricciones
de cuenta. No duplicar reglas de permisos ni introducir APIs.

Diálogo nativo con `showModal/close`, backdrop, cierre por cancel y recuperación
de foco al trigger visible. Cerrar al pasar a desktop (721px), restaurar scroll
y conservar sección/datos/filtros. Un toque fuera exige comienzo y fin fuera
del rectángulo; no cerrar al arrastrar desde dentro. Scroll vertical sólo dentro
del cajón si falta altura; área táctil mínima44px, safe-area y sin scroll lateral.
Modales de negocio y dashboards embebidos conservan su funcionamiento.

Fuentes: CSS y Client Components de Next16.3.8 instaladas; patrón real de
CreatePlanDialog; [HTML Standard, diálogo](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element).
Se aplica el comportamiento de foco/modal del estándar mediante APIs nativas;
no se elimina manualmente open ni se añade tabindex al dialog. Sin dependencias
nuevas ni efectos de dominio/auditoría: presentación local del usuario autenticado.

Revisión táctil: mantener el diálogo durante pointerdown/pointerup y cerrar en
click sólo cuando el gesto comenzó y terminó fuera. Cerrar antes de la activación
táctil perdía el foco del trigger en Chrome con hasTouch/isMobile. El contrato
incluye recuperar foco y no transmitir ese click al contenido. Referencia:
[W3C Pointer Events, compatibilidad con mouse](https://www.w3.org/TR/pointerevents3/#compatibility-mapping-with-mouse-events).
La prueba existente de Centro de control abre ahora ☰ antes de navegar a720px;
sus comprobaciones funcionales y de datos se conservan.
El recorrido completo de Tab/ShiftTab también conserva el foco mediante límites
explícitos entre el primer y último botón habilitados, sin alterar teclas internas
ni acciones de cada sección. Contrato puro probado de geometría y límites de foco;
ambos helpers requieren100% de cobertura y mutación.

## Escenarios y validación

| Caso | Evento y resultado                                                    | Datos/efectos       | Validación/fallo                              |
| ---- | --------------------------------------------------------------------- | ------------------- | --------------------------------------------- |
| NM01 | Carga móvil: menú cerrado, topbar arriba, contenido ocupa viewport    | Lecturas existentes | Chrome 320/390px, SSR/hidratación sin errores |
| NM02 | ☰ abre izquierda; lista única, mismos textos/íconos/orden            | Estado local        | DOM/geometría y captura real                  |
| NM03 | X, Escape y toque fuera cierran y recuperan foco                      | Estado/scroll local | E2E de cada salida                            |
| NM04 | Toque dentro o arrastre dentro→fuera no cierra                        | Estado local        | Unidad de geometría y pointer E2E             |
| NM05 | Seleccionar opción permitida cambia sección y cierra                  | Lecturas existentes | Ambas cuentas reales                          |
| NM06 | Restricción por rol conservada, opción prohibida deshabilitada        | Sin escrituras      | DOM y HTTP403 existentes                      |
| NM07 | Tab/ShiftTab mantienen foco en modal; fondo no recibe acciones/scroll | Estado local        | E2E de foco/scroll                            |
| NM08 | Altura corta/letra ampliada conserva último ítem y X                  | Sin efectos         | Scroll interior y sin desborde                |
| NM09 | Giro móvil y cambio a desktop cierran/restauran correctamente         | Sección conservada  | Resize721/720, scroll y triggers              |
| NM10 | Sidebar y toggle desktop mantienen comportamiento anterior            | Estado desktop      | E2E1280, separación de estados                |
| NM11 | Cerrar/abrir conserva filtros y modales; SSE no remonta el cajón      | Lecturas existentes | Regresión liquidación y actualización real    |
| NM12 | Dashboards embebidos no agregan menú ni backdrop                      | Sin efectos         | Regresión Centro de control                   |

NM-T01: componente/cableado/CSS/contrato de hit-testing. NM-T02: Gherkin,
unidad/cobertura/mutación de geometría y E2E/seguridad/regresión de navegación.
NM-T03: QA reproducible, métricas, typecheck/lint/build y entrega develop.
Objetivo100% del helper nuevo, cierres/roles/resize probados en navegador; no
atribuir cobertura servidor a UI. Mutación crítica monetaria no aplicable: no
cambia dominio; repetir recorrido existente de liquidación como regresión.

Auditoría local: GREEN LIGHT; INTEGRITY TOTAL con BL188 y Centro de control;
MATCH PERFECT con NM-T01..03. Rollback de presentación compatible con el mismo
esquema/API; no afecta datos financieros, configuración o APK.
