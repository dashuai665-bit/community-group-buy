import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../../server/application.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { createPhase4Database, seed } from '../helpers/sqlite-database.mjs';

async function setup() {
  const db = await createPhase4Database();
  seed(db, `INSERT INTO users(id) VALUES ('resident'),('adminA'),('adminB'),('platform'),('outsider');
    INSERT INTO user_profiles(user_id,display_name,phone) VALUES ('resident','住戶','0900000001'),('adminA','管理員','0900000002'),('adminB','管理員','0900000003'),('platform','平台','0900000004'),('outsider','訪客','0900000005');
    INSERT INTO user_identities(id,user_id,provider,provider_user_id) VALUES ('ir','resident','chatgpt','resident'),('ia','adminA','chatgpt','adminA'),('ib','adminB','chatgpt','adminB'),('ip','platform','chatgpt','platform'),('io','outsider','chatgpt','outsider');
    INSERT INTO communities(id,name,slug,status) VALUES ('A','A 社區','a','active'),('B','B 社區','b','active'),('X','停用社區','x','inactive');
    INSERT INTO community_members(id,user_id,community_id,role) VALUES ('mr','resident','A','resident'),('ma','adminA','A','community_admin'),('mb','adminB','B','community_admin'),('mp','platform','A','resident');
    INSERT INTO platform_roles(user_id,role) VALUES ('platform','platform_admin');
    INSERT INTO products(id,name,description,source_type,source_reference,unit_label,status) VALUES ('p1','白米','好米','supplier','private-ref','包','active'),('p2','麵粉',NULL,'manual',NULL,'包','active'),('p3','食用油',NULL,'supplier',NULL,'瓶','active');
    INSERT INTO community_product_offerings(id,community_id,product_id,status,price_minor,batch_threshold,min_quantity_per_order,max_quantity_per_order) VALUES ('oa','A','p1','active',19900,30,1,100),('ob','B','p1','active',20900,20,1,NULL),('paused','A','p2','paused',9900,10,1,NULL);`);
  const repositories = new Repositories({ db });
  const app = createApplication(repositories, { async authenticate(request) { const id = request.headers.get('x-user'); return id ? { provider: 'chatgpt', providerUserId: id, verified: true } : null; } });
  const call = async (method, path, user, body) => {
    const headers = new Headers();
    if (user) headers.set('x-user', user);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const options = { method, headers };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await app(new Request(`http://local${path}`, options));
    return { response, json: await response.json() };
  };
  // Exercise grouping via the supported HTTP order path, then read its batches.
  const orderBatches = async (user, body) => {
    const result = await call('POST', '/api/orders', user, {
      communityId: 'A', idempotencyKey: 'catalog-order-' + body.idempotencyKey,
      items: [{ offeringId: 'oa', quantity: body.quantity }],
    });
    assert.ok([200, 201].includes(result.response.status), JSON.stringify(result.json));
    return { response: result.response, json: { batches: await repositories.batches.listForOffering('oa') } };
  };
  return { db, repositories, call, orderBatches };
}

const scenarios = [
  ['1 anonymous reads active products', async ({ call }) => { const r=await call('GET','/api/communities/A/products'); assert.equal(r.response.status,200); assert.equal(r.json.offerings.length,1); }],
  ['2 inactive community list unavailable', async ({ call }) => assert.equal((await call('GET','/api/communities/X/products')).response.status,404)],
  ['3 paused offering hidden', async ({ call }) => { const r=await call('GET','/api/communities/A/products'); assert.equal(r.json.offerings.some(x=>x.offering_id==='paused'),false); }],
  ['4 detail is community scoped', async ({ call }) => assert.equal((await call('GET','/api/communities/A/products/oa')).response.status,200)],
  ['5 A cannot read B offering', async ({ call }) => assert.equal((await call('GET','/api/communities/A/products/ob')).response.status,404)],
  ['6 resident cannot create offering', async ({ call }) => assert.equal((await call('POST','/api/admin/communities/A/offerings','resident',{productId:'p2',priceMinor:100,batchThreshold:10,minQuantity:1})).response.status,403)],
  ['7 other admin cannot create offering', async ({ call }) => assert.equal((await call('POST','/api/admin/communities/A/offerings','adminB',{productId:'p2',priceMinor:100,batchThreshold:10,minQuantity:1})).response.status,403)],
  ['8 own admin creates offering', async ({ call }) => assert.equal((await call('POST','/api/admin/communities/A/offerings','adminA',{productId:'p3',priceMinor:100,batchThreshold:10,minQuantity:1})).response.status,201)],
  ['9 platform admin manages another community', async ({ call }) => assert.equal((await call('POST','/api/admin/communities/B/offerings','platform',{productId:'p2',priceMinor:100,batchThreshold:10,minQuantity:1})).response.status,201)],
  ['10 price validation', async ({ call }) => assert.equal((await call('POST','/api/admin/communities/A/offerings','adminA',{productId:'p2',priceMinor:0,batchThreshold:10,minQuantity:1})).response.status,422)],
  ['11 threshold validation', async ({ call }) => assert.equal((await call('POST','/api/admin/communities/A/offerings','adminA',{productId:'p2',priceMinor:1,batchThreshold:0,minQuantity:1})).response.status,422)],
  ['12 min max validation', async ({ call }) => assert.equal((await call('POST','/api/admin/communities/A/offerings','adminA',{productId:'p2',priceMinor:1,batchThreshold:10,minQuantity:5,maxQuantity:2})).response.status,422)],
  ['13 batch begins at zero', async ({ call }) => { const r=await call('GET','/api/communities/A/products/oa'); assert.equal(r.json.offering.committed_quantity,0); }],
  ['14 commit 26', async ({ orderBatches }) => { const r=await orderBatches('resident',{quantity:26,idempotencyKey:'q26'}); assert.equal(r.json.batches[0].committed_quantity,26); }],
  ['15 commit 26 then 4 forms batch', async ({ orderBatches }) => { await orderBatches('resident',{quantity:26,idempotencyKey:'a'}); const r=await orderBatches('resident',{quantity:4,idempotencyKey:'b'}); assert.equal(r.json.batches[0].status,'formed'); }],
  ['16 next commit opens batch 2', async ({ orderBatches }) => { await orderBatches('resident',{quantity:30,idempotencyKey:'a'}); const r=await orderBatches('resident',{quantity:7,idempotencyKey:'b'}); assert.equal(r.json.batches[1].committed_quantity,7); }],
  ['17 26 plus 10 splits', async ({ orderBatches }) => { await orderBatches('resident',{quantity:26,idempotencyKey:'a'}); const r=await orderBatches('resident',{quantity:10,idempotencyKey:'b'}); assert.deepEqual(r.json.batches.map(x=>x.committed_quantity),[30,6]); }],
  ['18 70 splits 30 30 10', async ({ orderBatches }) => { const r=await orderBatches('resident',{quantity:70,idempotencyKey:'q70'}); assert.deepEqual(r.json.batches.map(x=>x.committed_quantity),[30,30,10]); }],
  ['19 formed batch remains immutable', async ({ orderBatches }) => { await orderBatches('resident',{quantity:30,idempotencyKey:'a'}); const r=await orderBatches('resident',{quantity:1,idempotencyKey:'b'}); assert.deepEqual(r.json.batches.map(x=>x.committed_quantity),[30,1]); }],
  ['20 cancelled batch is skipped', async ({ orderBatches,db }) => { seed(db,"INSERT INTO group_buy_batches(id,offering_id,sequence_number,status,threshold_quantity) VALUES ('cancel','oa',1,'cancelled',30)"); const r=await orderBatches('resident',{quantity:1,idempotencyKey:'b'}); assert.equal(r.json.batches[0].committed_quantity,0); assert.equal(r.json.batches[1].committed_quantity,1); }],
  ['21 threshold change preserves old snapshot', async ({ call,orderBatches,repositories }) => { await orderBatches('resident',{quantity:1,idempotencyKey:'a'}); await call('PATCH','/api/admin/communities/A/offerings/oa','adminA',{priceMinor:19900,batchThreshold:24,minQuantity:1,maxQuantity:100,status:'active'}); assert.equal((await repositories.batches.listForOffering('oa'))[0].threshold_quantity,30); }],
  ['22 concurrent crossing does not overcount', async ({ orderBatches }) => { await orderBatches('resident',{quantity:29,idempotencyKey:'a'}); const [x,y]=await Promise.all([orderBatches('resident',{quantity:1,idempotencyKey:'b'}),orderBatches('adminA',{quantity:1,idempotencyKey:'c'})]); assert.equal(x.response.status,201); assert.equal(y.response.status,201); assert.deepEqual(y.json.batches.map(z=>z.committed_quantity),[30,1]); }],
  ['23 sequence remains unique', async ({ orderBatches,repositories }) => { await Promise.all([orderBatches('resident',{quantity:40,idempotencyKey:'a'}),orderBatches('adminA',{quantity:40,idempotencyKey:'b'})]); const rows=await repositories.batches.listForOffering('oa'); assert.equal(new Set(rows.map(x=>x.sequence_number)).size,rows.length); }],
  ['24 idempotent retry leaves no partial state', async ({ orderBatches }) => { await orderBatches('resident',{quantity:4,idempotencyKey:'same'}); const r=await orderBatches('resident',{quantity:4,idempotencyKey:'same'}); assert.equal(r.json.batches[0].committed_quantity,4); }],
  ['25 anonymous cannot wish', async ({ call }) => assert.equal((await call('POST','/api/communities/A/wishes',null,{wishText:'菜'})).response.status,401)],
  ['26 non member cannot wish', async ({ call }) => assert.equal((await call('POST','/api/communities/A/wishes','outsider',{wishText:'菜'})).response.status,403)],
  ['27 member can wish', async ({ call }) => assert.equal((await call('POST','/api/communities/A/wishes','resident',{wishText:'菜'})).response.status,201)],
  ['28 inactive community cannot wish', async ({ call }) => assert.equal((await call('POST','/api/communities/X/wishes','resident',{wishText:'菜'})).response.status,422)],
  ['29 my wishes only returns self', async ({ call }) => { await call('POST','/api/communities/A/wishes','resident',{wishText:'我的'}); await call('POST','/api/communities/A/wishes','adminA',{wishText:'別人'}); const r=await call('GET','/api/me/wishes','resident'); assert.deepEqual(r.json.wishes.map(x=>x.wish_text),['我的']); }],
  ['30 community admin sees own community wishes', async ({ call }) => { await call('POST','/api/communities/A/wishes','resident',{wishText:'A'}); const r=await call('GET','/api/admin/communities/A/wishes','adminA'); assert.equal(r.json.wishes.length,1); }],
  ['31 other admin gets 403', async ({ call }) => assert.equal((await call('GET','/api/admin/communities/A/wishes','adminB')).response.status,403)],
  ['32 platform admin succeeds', async ({ call }) => assert.equal((await call('GET','/api/admin/communities/B/wishes','platform')).response.status,200)],
  ['33 wish transition audit is correct', async ({ call,repositories }) => { const w=await call('POST','/api/communities/A/wishes','resident',{wishText:'菜'}); await call('PATCH',`/api/admin/communities/A/wishes/${w.json.wish.id}`,'adminA',{status:'reviewing'}); const logs=await repositories.audits.list(); assert.equal(logs.some(x=>x.action_type==='wish_status_changed'&&x.metadata.includes('reviewing')),true); }],
  ['34 public API excludes internals', async ({ call }) => { const r=await call('GET','/api/communities/A/products'); const raw=JSON.stringify(r.json); assert.equal(raw.includes('private-ref'),false); assert.equal(raw.includes('source_reference'),false); }],
  ['35 audit excludes secrets and contact data', async ({ orderBatches,repositories }) => { await orderBatches('resident',{quantity:30,idempotencyKey:'safe'}); const raw=JSON.stringify(await repositories.audits.list()); assert.equal(/token|0912345678|private-ref/i.test(raw),false); }],
];

for (const [name, scenario] of scenarios) test(name, async () => { const context=await setup(); try { await scenario(context); } finally { context.db.close(); } });
