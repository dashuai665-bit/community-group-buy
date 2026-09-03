import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/page.tsx', import.meta.url);
const layoutUrl = new URL('../app/layout.tsx', import.meta.url);

test('首頁包含品牌名稱與標語', async () => {
  const page = await readFile(pageUrl, 'utf8');

  assert.match(page, /鄰里湊湊/);
  assert.match(page, /一起湊，更划算/);
});

test('網站語系設定為繁體中文', async () => {
  const layout = await readFile(layoutUrl, 'utf8');

  assert.match(layout, /lang="zh-Hant"/);
});
