Feature: A delivery contact archived in Odoo does not block other orders
  Scenario: An archived contact and an active contact have the same name
    Given eligible orders belong to different Odoo delivery contact IDs with identical names
    And only one contact has active false in Odoo
    When the administrator queries orders for the date
    Then a yellow warning below the summary identifies only that contact's order folio and name
    And the remaining pending and validated orders are selectable with the existing filters
    And the archived order cannot be selected or included by select all

  Scenario: Every eligible order belongs to an archived delivery contact
    When the administrator queries those orders
    Then the warning lists the affected folios
    And saving remains disabled without changing the plan or vehicles

  Scenario: A selected delivery contact is archived after preview
    When the administrator confirms the original selection
    Then the existing changed-candidate check rejects the whole selection atomically
    And querying again permits a new selection of the remaining active contacts

  Scenario: Unknown metadata, permissions or connection failures
    When a contact cannot be read or its active state is not a boolean
    Then the query fails explicitly without labelling it as archived or saving a partial selection

  Scenario: Existing import contracts remain enforced
    Then validated orders still use validation date and pending orders still use scheduled date
    And manual folios still require validated outgoing deliveries and reject unavailable folios atomically
    And company isolation, exact delivery addresses, retries and route-start validation remain enforced
