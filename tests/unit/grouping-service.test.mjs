import assert from 'node:assert/strict';
import test from 'node:test';
import { GroupingService } from '../../server/services/groupings.ts';

function fixture(overrides = {}) {
  const calls = { batches: [] };
  const grouping = {
    id: 'batch-a',
    offering_id: 'offering-a',
    community_id: 'community-a',
    status: 'open',
    committed_quantity: 12,
    threshold_quantity: 30,
  };
  const repositories = {
    users: { findById: async () => ({ id: 'admin', status: 'active' }) },
    communities: { findById: async (id) => (id === 'missing' ? null : { id }) },
    platformRoles: { isPlatformAdmin: async () => false },
    members: {
      find: async () => ({ status: 'active', role: 'community_admin' }),
    },
    batches: {
      listForCommunity: async () => [grouping],
      findGrouping: async (communityId, id) =>
        communityId === 'community-a' && id === 'batch-a' ? grouping : null,
      listDemand: async () => [],
      manualFormStatement: () => ({ name: 'form' }),
      manualFormationAuditStatement: (value) => ({ name: 'audit', value }),
    },
    orders: { deriveStatusesForBatchStatement: () => ({ name: 'derive' }) },
    batch: async (statements) => {
      calls.batches.push(statements);
      return [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ];
    },
    ...overrides,
  };
  return { calls, grouping, repositories };
}

test('community admin can list only the requested community grouping scope', async () => {
  const { repositories } = fixture();
  const result = await new GroupingService(repositories).list(
    'admin',
    'community-a',
  );
  assert.equal(result[0].community_id, 'community-a');
});

test('resident cannot read grouping operations', async () => {
  const { repositories } = fixture({
    members: { find: async () => ({ status: 'active', role: 'resident' }) },
  });
  await assert.rejects(
    new GroupingService(repositories).list('resident', 'community-a'),
    (error) => error.status === 403,
  );
});

test('unknown community and cross-community grouping remain not found', async () => {
  const { repositories } = fixture();
  const service = new GroupingService(repositories);
  await assert.rejects(
    service.list('admin', 'missing'),
    (error) => error.status === 404,
  );
  await assert.rejects(
    service.get('admin', 'community-b', 'batch-a'),
    (error) => error.status === 404,
  );
});

test('manual formation updates batch, derives orders, and writes one scoped audit atomically', async () => {
  const { calls, repositories } = fixture();
  await new GroupingService(repositories).form(
    'admin',
    'community-a',
    'batch-a',
    '供應商可先出貨',
  );
  assert.equal(calls.batches.length, 1);
  assert.deepEqual(
    calls.batches[0].map((item) => item.name),
    ['form', 'audit', 'derive'],
  );
  assert.deepEqual(calls.batches[0][1].value, {
    groupingId: 'batch-a',
    actorUserId: 'admin',
    communityId: 'community-a',
    reason: '供應商可先出貨',
    quantity: 12,
    threshold: 30,
  });
});

test('known compare-and-set conflict maps to FORMATION_CONFLICT', async () => {
  const { repositories } = fixture({
    batch: async () => [{ meta: { changes: 0 } }],
  });
  await assert.rejects(
    new GroupingService(repositories).form(
      'admin',
      'community-a',
      'batch-a',
      '原因',
    ),
    (error) => error.status === 409 && error.code === 'FORMATION_CONFLICT',
  );
});

test('unexpected repository error is preserved for the global 500 boundary', async () => {
  const failure = new Error('D1 unavailable: SELECT secret FROM token');
  const { repositories } = fixture({
    batch: async () => {
      throw failure;
    },
  });
  await assert.rejects(
    new GroupingService(repositories).form(
      'admin',
      'community-a',
      'batch-a',
      '原因',
    ),
    (error) => error === failure,
  );
});

test('formed or empty grouping cannot be manually formed again', async () => {
  for (const grouping of [
    { status: 'formed', committed_quantity: 12 },
    { status: 'open', committed_quantity: 0 },
  ]) {
    const { repositories } = fixture();
    repositories.batches.findGrouping = async () => ({
      id: 'batch-a',
      threshold_quantity: 30,
      ...grouping,
    });
    await assert.rejects(
      new GroupingService(repositories).form(
        'admin',
        'community-a',
        'batch-a',
        '原因',
      ),
      (error) => error.status === 409,
    );
  }
});

test('inactive community remains readable without bypassing membership authorization', async () => {
  const { repositories } = fixture({
    communities: {
      findById: async () => ({ id: 'community-a', status: 'inactive' }),
    },
  });
  const result = await new GroupingService(repositories).list(
    'admin',
    'community-a',
  );
  assert.equal(result.length, 1);
});
