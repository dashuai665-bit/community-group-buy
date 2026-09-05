import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export function readFixture<T>(read: (db: DatabaseSync) => T): T {
  const directory = process.env.E2E_FIXTURE_DIR;
  if (!directory)
    throw new Error('Playwright did not configure the isolated fixture DB');
  const db = new DatabaseSync(join(directory, 'fixture.sqlite'), {
    readOnly: true,
  });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

// Read committed facts from the exact DB used by the external proxy, never the app's local D1.
export function expectOrderTail(
  orderId: string,
  purchaseBatchId: string,
  fulfilled: number,
  shortage: number,
  phase: 'finalized' | 'paid' | 'completed',
) {
  readFixture((db) => {
    const quantity = fulfilled + shortage;
    const amount = fulfilled * 120;
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    expect(order).toMatchObject({
      user_id: 'e2e-resident',
      community_id: 'e2e-c1',
      status:
        phase === 'completed'
          ? 'completed'
          : phase === 'paid'
            ? 'ready_for_pickup'
            : 'formed',
    });
    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id=?')
      .all(orderId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      quantity,
      unit_price_minor: fulfilled ? 100 : 50,
      estimated_subtotal_minor: quantity * (fulfilled ? 100 : 50),
    });
    expect(order?.estimated_total_minor).toBe(
      items[0].estimated_subtotal_minor,
    );
    const allocations = db
      .prepare(
        'SELECT pa.* FROM purchase_allocations pa JOIN order_items oi ON oi.id=pa.order_item_id WHERE oi.order_id=?',
      )
      .all(orderId);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      purchase_batch_id: purchaseBatchId,
      committed_quantity_snapshot: quantity,
      fulfilled_quantity: fulfilled,
      shortage_quantity: shortage,
      final_amount_minor: amount,
    });
    const groupingId = allocations[0].group_buy_batch_id;
    expect(
      db
        .prepare('SELECT * FROM batch_commitments WHERE id=?')
        .get(allocations[0].batch_commitment_id),
    ).toMatchObject({
      batch_id: groupingId,
      order_item_id: items[0].id,
      quantity,
      status: 'active',
    });
    expect(
      db
        .prepare('SELECT committed_quantity FROM group_buy_batches WHERE id=?')
        .get(groupingId),
    ).toEqual({ committed_quantity: quantity });
    expect(
      db
        .prepare(
          'SELECT * FROM purchase_group_results WHERE group_buy_batch_id=?',
        )
        .get(groupingId),
    ).toMatchObject({
      purchase_batch_id: purchaseBatchId,
      committed_quantity_snapshot: quantity,
      purchased_quantity: fulfilled,
      shortage_quantity: shortage,
      actual_unit_price_minor: 120,
      actual_subtotal_minor: amount,
    });
    const finalizations = db
      .prepare(
        'SELECT * FROM purchase_batch_finalizations WHERE purchase_batch_id=?',
      )
      .all(purchaseBatchId);
    expect(finalizations).toHaveLength(1);
    expect(finalizations[0]).toMatchObject({
      committed_quantity: quantity,
      purchased_quantity: fulfilled,
      shortage_quantity: shortage,
      actual_total_minor: amount,
      finalized_by_user_id: 'e2e-admin',
    });
    expect(finalizations[0].finalized_at).toEqual(expect.any(String));
    const payments = db
      .prepare('SELECT * FROM cash_payments WHERE order_id=?')
      .all(orderId);
    const pickups = db
      .prepare('SELECT * FROM pickup_records WHERE order_id=?')
      .all(orderId);
    expect(payments).toHaveLength(phase === 'finalized' ? 0 : 1);
    expect(pickups).toHaveLength(phase === 'finalized' ? 0 : 1);
    if (phase !== 'finalized') {
      expect(payments[0]).toMatchObject({
        amount_minor: amount,
        method: 'cash',
        status: 'paid',
        community_id: 'e2e-c1',
        confirmed_by_user_id: 'e2e-admin',
        confirmed_at: expect.any(String),
      });
      expect(pickups[0]).toMatchObject({
        community_id: 'e2e-c1',
        status: phase === 'completed' ? 'picked_up' : 'ready',
        handed_over_by_user_id: phase === 'completed' ? 'e2e-admin' : null,
        picked_up_at: phase === 'completed' ? expect.any(String) : null,
      });
    }
    const events = db
      .prepare(`SELECT COALESCE(json_extract(metadata,'$.event'),action_type) AS event,actor_user_id,target_id
      FROM audit_logs WHERE community_id='e2e-c1' AND target_id IN (?,?,?)`)
      .all(orderId, purchaseBatchId, groupingId);
    for (const event of [
      'batch_formed',
      'PURCHASE_BATCH_CREATED',
      'PURCHASE_BATCH_STARTED',
      'PURCHASE_BATCH_FINALIZED',
    ]) {
      expect(
        events.filter((row) => row.event === event),
        event,
      ).toHaveLength(1);
    }
    for (const [event, count] of [
      ['CASH_PAYMENT_CONFIRMED', phase === 'finalized' ? 0 : 1],
      ['ORDER_HANDED_OVER', phase === 'completed' ? 1 : 0],
    ] as const) {
      const matches = events.filter((row) => row.event === event);
      expect(matches, event).toHaveLength(count);
      if (count)
        expect(matches[0]).toMatchObject({
          actor_user_id: 'e2e-admin',
          target_id: orderId,
        });
    }
  });
}
