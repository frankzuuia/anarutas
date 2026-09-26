Feature: Stable driver incident form
  Scenario: IF01 Incident cards are exclusive and do not submit
    Given the driver is attending a stop on their current route
    When the driver selects Pedido rechazado and then Cliente cerrado
    Then only Cliente cerrado has selected radio semantics and its check icon
    And no incident command has been sent

  Scenario: IF02 Disabled choices do not change selection
    Given sending is busy or the route is unverified
    When the driver attempts to select either incident card
    Then selection and the existing command remain unchanged
    And rejection is unavailable when there are no rejectable orders

  Scenario: IF03 Comments remain visible without recentering per character
    Given the comment editor is focused above the software keyboard
    When the driver types multiple lines and route feedback is recomposed
    Then the form header stays anchored and the comment keeps focus and text
    And only the scrollable body moves to reveal the caret

  Scenario: IF04 Long notes and small windows
    Given a small window or large font and more than four comment lines
    When the driver continues typing or rotates the device
    Then the editor has at most four visible lines and the form remains scrollable
    And the current stop draft is preserved with the existing 2000 character limit

  Scenario: IF05 Keyboard Done is not confirmation
    Given a rejection Other note or a rescheduling note is being edited
    When the driver presses keyboard Done
    Then the keyboard closes without sending or clearing the note
    And existing required-note and explicit-confirmation rules still apply

  Scenario: IF06 Camera and uncertain network preserve the draft
    Given a customer-closed draft with comment
    When camera returns or a GPS or network update arrives
    Then the draft stays intact until the confirmed receipt or explicit dismissal
    And no additional incident is submitted by the layout

  Scenario: IF07 Read-only dialogs and backend stay unchanged
    When the driver views stops, products or unit photos
    Then their existing read-only dialogs and authorization stay unchanged
    And map, GPS radius, guide and server incident contracts are not modified
