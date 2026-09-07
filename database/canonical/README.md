# Canonical current schema (offline only)

Baseline: ca7c42b7d4c109a3871f69169fe030880590f030.

`current-schema.sql` is extracted from the actual `sqlite_master.sql` of an
empty SQLite database after executing the unmodified historical 0000–0007
files, using the existing `createPhase3Database` helper. It is NOT generated
from the ORM, a production migration runner, or a legacy data conversion.
Historical execution follows the existing per-file, autocommit SQLite helper;
this does not certify that the historical chain works under D1 transaction rules.

Extraction selects all non-NULL SQL, ordered by table, index, trigger, then
name, and appends statement terminators. SQLite automatically recreates the
24 implicit indexes from PRIMARY KEY and UNIQUE constraints. The checked-in
inventory explicitly names 22 tables, 30 explicit indexes and 22 triggers.
Tests also compare implicit indexes through sqlite_master and PRAGMAs.

Run only:

```sh
node --test tests/integration/canonical-equivalence.test.mjs tests/integration/canonical-invariants.test.mjs
```

The equivalence test builds two independent memory databases. It compares
CREATE SQL (including CHECK and trigger bodies), table_info/table_xinfo,
foreign_key_list, index_list, index_info/index_xinfo. Only index-list enumeration
order is discarded; uniqueness, origin, partial flag and indexed columns remain.
SQL token normalization preserves string literal values, operators and order.
Mutation checks prove that dropped indexes, modified triggers and CHECK changes
are detected. Every table must be empty before invariant fixtures are inserted.
The invariant cases are SQL-only cases adapted from the existing schema tests,
now run against the standalone canonical baseline. They do not call app services.

## Isolation

Do not copy these files into drizzle/. This directory has no application imports
and remains an offline schema baseline. The independently managed Cloudflare
production migration contract and operator workflow remain separate work.
The retained `.openai/hosting.json` is legacy Sites evidence only; neither the
production build nor runtime reads it as configuration.

## ORM_SCHEMA_DRIFT at ca7c42b

The historical final schema and this baseline agree. The ORM is not a complete
DDL source. Memory-only generation from db/schema.ts confirmed matching columns,
types, nullability, defaults, primary-key positions and FK relationships/actions
(disregarding column ordering and FK enumeration IDs). Known differences:

- purchase_receipts: missing CHECK size_bytes > 0 AND size_bytes <= 10485760.
- purchase_batch_finalizations: missing five CHECKs: committed_quantity >= 0;
  purchased_quantity >= 0 AND purchased_quantity <= committed_quantity;
  shortage_quantity = committed_quantity - purchased_quantity;
  estimated_total_minor >= 0; actual_total_minor >= 0.
  Missing unique index purchase_batch_finalizations_idempotency_unique.
- purchase_group_results: missing six CHECKs: committed_quantity_snapshot >= 0;
  purchased_quantity >= 0 AND purchased_quantity <= committed_quantity_snapshot;
  shortage_quantity = committed_quantity_snapshot - purchased_quantity;
  actual_unit_price_minor >= 0; estimated_subtotal_minor >= 0;
  actual_subtotal_minor = purchased_quantity * actual_unit_price_minor.
  Missing index purchase_group_results_purchase_batch_idx.
- purchase_allocations: missing four CHECKs: committed_quantity_snapshot > 0;
  fulfilled_quantity >= 0 AND fulfilled_quantity <= committed_quantity_snapshot;
  shortage_quantity = committed_quantity_snapshot - fulfilled_quantity;
  final_amount_minor >= 0. Missing index purchase_allocations_order_item_idx.
- All 22 operational triggers are migration-defined, not represented by db/schema.ts.
- purchase_receipts uniqueness is modeled with named unique indexes by ORM
  generation, versus inline UNIQUE constraints/implicit indexes in historical DDL.
  Uniqueness semantics match; the schema objects and index origins differ.
- cash_payments CHECK expressions are named in ORM and unnamed inline in SQL.
- pickup_records physical column order differs: historical ALTER TABLE appended
  the three handover/location columns after timestamps; ORM lists them before.

These are reported without changing db/schema.ts or historical SQL/metadata.
Handover immutability here refers to the historical UPDATE protection; this work
adds no new DELETE guard and makes no claim of additional business invariants.
