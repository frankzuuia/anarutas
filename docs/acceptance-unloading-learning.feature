Feature: Automatic customer unloading duration
  Scenario: Measured minutes are not a fixed thirty minute default
    Given two complete visits take 22 minutes each
    When a new route is built
    Then Google receives 1320 seconds of unloading duration for the visit

  Scenario: Learn from two visits and adapt continuously
    Given a customer has a manual duration of 15 minutes
    When two complete visits take 30 minutes each
    Then new routing uses 30 minutes
    When the next visits take 40 and 40 minutes
    Then new routing uses 40 minutes from the latest three visits

  Scenario: Several orders form one visit
    Given a customer has two orders in the active stop
    When the driver collects the first order
    Then no complete visit is learned
    When the driver collects the last order
    Then exactly one visit ends at the final captured collection time

  Scenario: Offline retry keeps the original time
    Given the payment command was captured 30 minutes after arrival
    When the same command is received later and replayed concurrently
    Then there is one payment and one 30 minute visit

  Scenario: Invalid timing does not change collections
    When timing is absent or outside arrival and server receipt
    Then the valid payment is accepted without a learning sample

  Scenario: Manual mode and location changes
    Given a customer has learned observations
    When an authorized administrator chooses a fixed manual value
    Then routing uses the manual value
    And stale or unauthorized edits are rejected
    When the customer location changes
    Then old observations do not seed the new location

  Scenario: Historical routes remain stable
    Given a route was published with its unloading duration
    When another visit changes the learned duration
    Then the published route and its live duration remain unchanged
    And no Google recalculation is queued by learning
