import assert from 'node:assert/strict';
import test from 'node:test';
import { Repositories } from '../../server/repositories/index.ts';
import { GroupingService } from '../../server/services/groupings.ts';
import { OrderService } from '../../server/services/orders.ts';
import { createPhase4BDatabase, seed } from '../helpers/sqlite-database.mjs';

async function setup() {
  const db = await createPhase4BDatabase();
  seed(
    db,
    `INSERT INTO users(id) VALUES ('u1'),('u2'),('admin');
    INSERT INTO user_profiles(user_id,display_name,phone) VALUES ('u1','甲','0900000001'),('u2','乙','0900000002'),('admin','管','0900000003');
    INSERT INTO communities(id,name,slug) VALUES ('A','A','a');
    INSERT INTO community_members(id,user_id,community_id,role) VALUES ('m1','u1','A','resident'),('m2','u2','A','resident'),('ma','admin','A','community_admin');
    INSERT INTO products(id,name,source_type,unit_label) VALUES ('p','米','manual','包');
    INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order) VALUES ('o','A','p',100,30,1);`,
  );
  const repositories = new Repositories({ db });
  return {
    db,
    repositories,
    orders: new OrderService(repositories),
    groupings: new GroupingService(repositories),
  };
}

function rows(db, sql, ...parameters) {
  return db.database
    .prepare(sql)
    .all(...parameters)
    .map((row) => ({ ...row }));
}

test('Case A: concurrent real orders cross threshold exactly once without lost or double-assigned demand', async () => {
  const context = await setup();
  try {
    await context.orders.create('u1', {
      communityId: 'A',
      idempotencyKey: 'existing-29',
      items: [{ offeringId: 'o', quantity: 29 }],
    });
    const results = await Promise.all([
      context.orders.create('u1', {
        communityId: 'A',
        idempotencyKey: 'crossing-u1',
        items: [{ offeringId: 'o', quantity: 1 }],
      }),
      context.orders.create('u2', {
        communityId: 'A',
        idempotencyKey: 'crossing-u2',
        items: [{ offeringId: 'o', quantity: 1 }],
      }),
    ]);

    assert.equal(
      results.every((result) => result.created),
      true,
    );
    assert.equal(rows(context.db, 'SELECT id FROM orders').length, 3);
    assert.equal(rows(context.db, 'SELECT id FROM order_items').length, 3);
    const commitments = rows(
      context.db,
      `SELECT order_item_id,COUNT(*) AS assignments,SUM(quantity) AS quantity
       FROM batch_commitments WHERE status='active' GROUP BY order_item_id`,
    );
    assert.equal(commitments.length, 3);
    assert.equal(
      commitments.every((row) => row.assignments === 1),
      true,
    );
    assert.equal(
      commitments.reduce((sum, row) => sum + Number(row.quantity), 0),
      31,
    );
    assert.deepEqual(
      rows(
        context.db,
        'SELECT sequence_number,status,committed_quantity FROM group_buy_batches ORDER BY sequence_number',
      ),
      [
        { sequence_number: 1, status: 'formed', committed_quantity: 30 },
        { sequence_number: 2, status: 'open', committed_quantity: 1 },
      ],
    );
    assert.deepEqual(
      rows(
        context.db,
        'SELECT status,COUNT(*) count FROM orders GROUP BY status ORDER BY status',
      ),
      [
        { status: 'formed', count: 2 },
        { status: 'submitted', count: 1 },
      ],
    );
    assert.equal(
      rows(
        context.db,
        "SELECT id FROM audit_logs WHERE action_type='batch_formed'",
      ).length,
      1,
    );
  } finally {
    context.db.close();
  }
});

test('Case B: concurrent same idempotency key counts one order, commitment, quantity, and formation', async () => {
  const context = await setup();
  try {
    await context.orders.create('u2', {
      communityId: 'A',
      idempotencyKey: 'base-29',
      items: [{ offeringId: 'o', quantity: 29 }],
    });
    const input = {
      communityId: 'A',
      idempotencyKey: 'same-crossing-key',
      items: [{ offeringId: 'o', quantity: 1 }],
    };
    const [first, retry] = await Promise.all([
      context.orders.create('u1', input),
      context.orders.create('u1', input),
    ]);

    assert.equal(first.order.id, retry.order.id);
    assert.equal(
      rows(context.db, "SELECT id FROM orders WHERE user_id='u1'").length,
      1,
    );
    assert.equal(
      rows(
        context.db,
        "SELECT id FROM batch_commitments WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id='u1'))",
      ).length,
      1,
    );
    assert.deepEqual(
      rows(
        context.db,
        'SELECT status,committed_quantity FROM group_buy_batches',
      ),
      [{ status: 'formed', committed_quantity: 30 }],
    );
    assert.equal(
      rows(
        context.db,
        "SELECT id FROM audit_logs WHERE action_type='batch_formed'",
      ).length,
      1,
    );
  } finally {
    context.db.close();
  }
});

test('Case C: demand after formation goes only to the next open grouping instance', async () => {
  const context = await setup();
  try {
    await context.orders.create('u1', {
      communityId: 'A',
      idempotencyKey: 'form-first',
      items: [{ offeringId: 'o', quantity: 30 }],
    });
    const next = await context.orders.create('u2', {
      communityId: 'A',
      idempotencyKey: 'after-formation',
      items: [{ offeringId: 'o', quantity: 4 }],
    });
    const assignment = rows(
      context.db,
      `SELECT b.sequence_number,b.status,bc.quantity FROM batch_commitments bc
       JOIN group_buy_batches b ON b.id=bc.batch_id
       JOIN order_items oi ON oi.id=bc.order_item_id WHERE oi.order_id=?`,
      next.order.id,
    );
    assert.deepEqual(assignment, [
      { sequence_number: 2, status: 'open', quantity: 4 },
    ]);
    assert.deepEqual(
      rows(
        context.db,
        'SELECT sequence_number,status,committed_quantity FROM group_buy_batches ORDER BY sequence_number',
      ),
      [
        { sequence_number: 1, status: 'formed', committed_quantity: 30 },
        { sequence_number: 2, status: 'open', committed_quantity: 4 },
      ],
    );
  } finally {
    context.db.close();
  }
});

test('concurrent manual formation has one CAS transition, one audit, and no partial state', async () => {
  const context = await setup();
  try {
    await context.orders.create('u1', {
      communityId: 'A',
      idempotencyKey: 'manual-base',
      items: [{ offeringId: 'o', quantity: 12 }],
    });
    const [{ id: groupingId }] = rows(
      context.db,
      "SELECT id FROM group_buy_batches WHERE status='open'",
    );
    seed(
      context.db,
      `CREATE TABLE manual_order_update_effects(effect_count INTEGER NOT NULL);
       INSERT INTO manual_order_update_effects VALUES(0);
       CREATE TRIGGER count_manual_order_update BEFORE UPDATE ON orders
       BEGIN UPDATE manual_order_update_effects SET effect_count=effect_count+1; END;`,
    );
    const outcomes = await Promise.allSettled([
      context.groupings.form('admin', 'A', groupingId, '原因一'),
      context.groupings.form('admin', 'A', groupingId, '原因二'),
    ]);

    assert.equal(
      outcomes.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const rejected = outcomes.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    assert.equal(rejected.reason.code, 'FORMATION_CONFLICT');
    assert.deepEqual(
      rows(
        context.db,
        'SELECT status,committed_quantity FROM group_buy_batches',
      ),
      [{ status: 'formed', committed_quantity: 12 }],
    );
    assert.deepEqual(rows(context.db, 'SELECT status FROM orders'), [
      { status: 'formed' },
    ]);
    assert.equal(
      rows(
        context.db,
        "SELECT id FROM audit_logs WHERE id LIKE 'manual-form-%'",
      ).length,
      1,
    );
    assert.equal(
      rows(context.db, 'SELECT id FROM batch_commitments').length,
      1,
    );
    assert.equal(
      rows(context.db, 'SELECT effect_count FROM manual_order_update_effects')[0]
        .effect_count,
      1,
    );
  } finally {
    context.db.close();
  }
});

test('Case D: one production order item splits 30 formed plus 1 open and is partially formed', async () => {
  const context = await setup();
  try {
    const result = await context.orders.create('u1', {
      communityId: 'A',
      idempotencyKey: 'single-split-31',
      items: [{ offeringId: 'o', quantity: 31 }],
    });
    assert.equal(rows(context.db, 'SELECT id FROM orders').length, 1);
    assert.equal(rows(context.db, 'SELECT id FROM order_items').length, 1);
    assert.deepEqual(
      rows(
        context.db,
        `SELECT b.sequence_number,b.status,bc.quantity FROM batch_commitments bc
         JOIN group_buy_batches b ON b.id=bc.batch_id ORDER BY b.sequence_number`,
      ),
      [
        { sequence_number: 1, status: 'formed', quantity: 30 },
        { sequence_number: 2, status: 'open', quantity: 1 },
      ],
    );
    assert.deepEqual(
      rows(
        context.db,
        'SELECT sequence_number,status,committed_quantity FROM group_buy_batches ORDER BY sequence_number',
      ),
      [
        { sequence_number: 1, status: 'formed', committed_quantity: 30 },
        { sequence_number: 2, status: 'open', committed_quantity: 1 },
      ],
    );
    assert.equal(
      rows(context.db, 'SELECT SUM(quantity) total FROM batch_commitments')[0]
        .total,
      31,
    );
    assert.equal(
      rows(
        context.db,
        'SELECT COUNT(*) count FROM batch_commitments GROUP BY batch_id,order_item_id',
      ).every((row) => row.count === 1),
      true,
    );
    assert.equal(
      rows(
        context.db,
        'SELECT status FROM orders WHERE id=?',
        result.order.id,
      )[0].status,
      'partially_formed',
    );
  } finally {
    context.db.close();
  }
});

test('Case E: one production order of 60 forms two fixed packs and is formed', async () => {
  const context = await setup();
  try {
    const result = await context.orders.create('u1', {
      communityId: 'A',
      idempotencyKey: 'single-60',
      items: [{ offeringId: 'o', quantity: 60 }],
    });
    assert.deepEqual(
      rows(
        context.db,
        `SELECT b.sequence_number,b.status,bc.quantity FROM batch_commitments bc
         JOIN group_buy_batches b ON b.id=bc.batch_id ORDER BY b.sequence_number`,
      ),
      [
        { sequence_number: 1, status: 'formed', quantity: 30 },
        { sequence_number: 2, status: 'formed', quantity: 30 },
      ],
    );
    assert.equal(
      rows(
        context.db,
        'SELECT status FROM orders WHERE id=?',
        result.order.id,
      )[0].status,
      'formed',
    );
  } finally {
    context.db.close();
  }
});

test('Case F: later demand completes the open allocation and advances original order to formed', async () => {
  const context = await setup();
  try {
    const original = await context.orders.create('u1', {
      communityId: 'A',
      idempotencyKey: 'partial-first-31',
      items: [{ offeringId: 'o', quantity: 31 }],
    });
    assert.equal(
      rows(
        context.db,
        'SELECT status FROM orders WHERE id=?',
        original.order.id,
      )[0].status,
      'partially_formed',
    );
    await context.orders.create('u2', {
      communityId: 'A',
      idempotencyKey: 'complete-remainder-29',
      items: [{ offeringId: 'o', quantity: 29 }],
    });
    assert.equal(
      rows(
        context.db,
        'SELECT status FROM orders WHERE id=?',
        original.order.id,
      )[0].status,
      'formed',
    );
  } finally {
    context.db.close();
  }
});

test('manual formation uses the same semantics to advance partial order to formed', async () => {
  const context = await setup();
  try {
    const original = await context.orders.create('u1', {
      communityId: 'A',
      idempotencyKey: 'manual-partial-31',
      items: [{ offeringId: 'o', quantity: 31 }],
    });
    assert.equal(
      rows(
        context.db,
        'SELECT status FROM orders WHERE id=?',
        original.order.id,
      )[0].status,
      'partially_formed',
    );
    const [{ id: openBatchId }] = rows(
      context.db,
      "SELECT id FROM group_buy_batches WHERE status='open'",
    );
    await context.groupings.form(
      'admin',
      'A',
      openBatchId,
      '供應商確認可先成團',
    );
    assert.equal(
      rows(
        context.db,
        'SELECT status FROM orders WHERE id=?',
        original.order.id,
      )[0].status,
      'formed',
    );
  } finally {
    context.db.close();
  }
});
