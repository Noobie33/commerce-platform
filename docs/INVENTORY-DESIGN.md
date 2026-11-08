# Next increment: multi-location inventory

The catalog and original-media work are prerequisites. This document defines the next implementation slice; it does not claim that stock posting is already available.

## Business scope

- Active warehouses/stores identified by stable location IDs and codes.
- On-hand stock by sellable variant and location.
- Opening stock / receipts, transfers and reasoned adjustments.
- Searchable stock and immutable movement history.
- No negative on-hand stock by default.
- Actual quantity data connected to the UI after posting is implemented.

On-hand is distinct from saleable/available stock. Reservations, damaged/quarantined stock and purchase/sales fulfilment require explicit later workflows; labels must not imply they already exist.

The first quantity unit is whole pieces per SKU. Fabric length/weight, unit conversion, kits and manufacturing consumption need a separate base-unit/conversion design before enabling them.

## Integrity requirements

A posting has an immutable ID, action, actor, reason/reference, timestamp, idempotency key and lines. Corrections add a compensating posting; posted history is not edited or deleted.

Transfers debit and credit the same variant quantity across different locations in one transaction. Receipts add quantity at one location. Adjustments require a reason and preserve the previous movement history.

All writes must authorise the action for each affected location, use deterministic locking, enforce quantity bounds, commit audit with the posting and handle retries without duplicating stock. A transfer requires permission at both ends. A location grant must not expose or mutate another location.

Ledger-derived totals and any maintained balance must reconcile. Runtime privileges must prevent deleting posted history or independently overwriting balances. The posting boundary will be selected and tested with these invariants, not left to frontend validation.

This slice covers quantities only. Purchase cost, landed cost, tax, inventory valuation and COGS must be added with purchasing/accounting policy; a stock receipt must not silently create a financial posting.

## Required verification before enabling stock entry

- Same request retried/concurrently submitted produces one posting.
- Concurrent decrements cannot oversell a location.
- Failed audit or one invalid transfer line rolls back the whole posting.
- Transfers remain balanced and no location can go negative.
- Scope checks protect both transfer endpoints and filtered stock/history reads.
- Inactive locations/SKUs follow explicit receipt/correction rules.
- Ledger totals reconcile after receipts, transfers and compensating adjustments.
- Database constraints/runtime privileges reject orphaned or mutable posted history.
- UI forms show location, action, quantities and reason before committing.

The implementation will keep controllers thin, transaction/invariant logic in an inventory service and schema changes in reviewed migrations, following the existing engineering standards.
