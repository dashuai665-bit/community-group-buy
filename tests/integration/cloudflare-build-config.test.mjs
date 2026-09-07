import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('production build configuration does not load or package Sites metadata', () => {
  const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const viteConfig = readFileSync(new URL('vite.config.ts', root), 'utf8');

  assert.equal(packageJson.dependencies?.['@openai/sites-vite-plugin'], undefined);
  assert.equal(packageJson.devDependencies?.['@openai/sites-vite-plugin'], undefined);
  assert.doesNotMatch(viteConfig, /@openai\/sites-vite-plugin/);
  assert.doesNotMatch(viteConfig, /\bsites\s*\(/);
  assert.doesNotMatch(viteConfig, /\.openai\/hosting\.json/);
  assert.match(viteConfig, /@cloudflare\/vite-plugin/);
  assert.match(viteConfig, /\bvinext\(\)/);
});
