Feature: Product incidents and weekly plan archive
  Scenario: Sunday cleanup preserves operational history
    Given plans from this week, next week and a started route
    When Sunday reaches 20:00 in the installation timezone
    Then past plans leave the planning selector exactly once
    And shipments, publications, driver access, incidents and metrics remain
    And a server restart catches up without duplicate audits

  Scenario: Report a product after verified arrival
    Given an authenticated assigned driver at an active verified visit
    When the driver selects an order line, reason, department and quantity
    Then the server binds the report to that immutable publication and line
    And aggregate quantities cannot exceed the published quantity
    And partial quantities keep the actual unit without conversion

  Scenario: Missing product was never listed
    When the driver reports a shortage by validation or from warehouse
    Then product name, unit, quantity, department and concept are required in the new form
    And warehouse requires its additional reason
    And no product identifier or Odoo stock movement is invented

  Scenario: Retries and competing changes
    Given the network loses the committed response
    When the same command is resent after restart
    Then the same receipt is returned without duplicating quantity
    And stale versions or changed command payloads are rejected

  Scenario: Denied requests
    When another driver, a revoked session or a driver without a current arrival submits
    Then no incident or partial quantity change is committed

  Scenario: Delivery with incidents preserves replacements
    Given a saved replacement or return on the order
    When the driver confirms attention acknowledging those incidents
    Then replacements remain pending in the live panel even after plan archival
    And the route is not settled and Odoo is unchanged

  Scenario: Classification and confidential reporting
    Given an administrator views an incident with its reporting driver's name
    When the administrator changes Department and Concept with the current version
    Then the change is audited and the original driver report is preserved
    And concurrent edits conflict instead of overwriting
    When the administrator exports the selected period and driver filter
    Then Excel has exactly Date, Customer, Product, Quantity, Unit, Department, Incident detail, Comments, Order
    And no driver name or Concept column is exported
    And formula-like text stays inert and all matching pages are exported

  Scenario: Resolution needs explicit administration action
    Given history shows the incident, evidence and classification but no Resolve button
    And the Resolve action is offered only in live incidents
    When an authenticated administrator explains how a replacement was resolved
    Then it leaves pending replacements but remains in history
    And resolution does not issue a delivery, refund or Odoo mutation

  Scenario: Required private evidence
    When a driver reports a replacement by quality, wrong product, or a return without a photo
    Then the application and server reject the report without partial writes
    When the driver captures a valid image and confirms the report
    Then administrators see its thumbnail and can open the full sanitized image
    And no unauthenticated user can read it
    And replaying the command does not duplicate the report or the file
    And weekly archive and closed-customer evidence cleanup preserve the product photo
    And shortages may still be reported without a photograph

  Scenario: Multiple reports for one order
    Given a driver has arrived and the order remains open
    When the driver saves twelve distinct product incidents one after another
    Then all twelve are retained and the driver can continue reporting
    And there is no incident-count limit per order
    And quantity limits still prevent reporting more than the actual published quantity

  Scenario: Three removable photos and durable replay
    Given a product-incident draft with three photographs
    When the driver removes the second photo and captures a new one
    Then the first and third remain unchanged and there are still three photos
    And one photo is sufficient to satisfy mandatory evidence
    And a fourth photo is rejected in the app, HTTP API and storage contract
    When the driver retries the same submitted report
    Then there is one report and one set of evidence, not duplicate photos

  Scenario: Clear choices and complete comments
    When the driver selects a shortage card
    Then it has the same radio-card presentation as closed and rejected incidents
    And selecting alone does not submit a report
    When the driver selects Ventas, Picking, two quick comments and additional notes
    Then the panel preserves the classification and all comments
    And Excel still has nine columns without concept, driver or photos
  Scenario: El chofer corrige una incidencia enviada y luego el cliente la cancela
    Given una visita activa con una incidencia de una unidad sobre dos publicadas
    Then el detalle muestra una unidad y una alerta en esa partida
    When el chofer modifica esa incidencia
    Then el formulario ofrece guardar y la edición conserva el mismo identificador con una versión nueva
    When el cliente acepta el producto y el chofer confirma eliminar la incidencia
    Then la incidencia queda cancelada y auditada, el detalle vuelve a dos unidades y el Excel no la incluye

  Scenario: Faltantes manuales múltiples sin alterar partidas publicadas
    Given un pedido con partidas publicadas y varios faltantes que no figuran en ellas
    Then cada faltante aparece por separado con alerta y las cantidades publicadas permanecen intactas
