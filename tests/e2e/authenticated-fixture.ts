import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
type Role = 'resident' | 'admin' | 'otherAdmin' | 'platform';
async function create(context: BrowserContext, role: Role) {
  await context.addCookies([{ name:'e2e-role', value:role, domain:'127.0.0.1', path:'/' }]);
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The HTTP-only test proxy intentionally does not forward Vite's dev HMR WebSocket.
    if (message.text().includes("WebSocket connection to 'ws://127.0.0.1:3211/")) return;
    // Authorization proof intentionally renders safe 403 API states in the browser.
    if (message.text() === 'Failed to load resource: the server responded with a status of 403 (Forbidden)') return;
    errors.push(message.text());
  });
  return { page, errors };
}
export const test = base.extend<{residentPage:Page;adminPage:Page;otherAdminPage:Page;platformAdminPage:Page}>({
  residentPage: async ({browser},run)=>{const c=await browser.newContext();const x=await create(c,'resident');await run(x.page);expect(x.errors).toEqual([]);await c.close();},
  adminPage: async ({browser},run)=>{const c=await browser.newContext();const x=await create(c,'admin');await run(x.page);expect(x.errors).toEqual([]);await c.close();},
  otherAdminPage: async ({browser},run)=>{const c=await browser.newContext();const x=await create(c,'otherAdmin');await run(x.page);expect(x.errors).toEqual([]);await c.close();},
  platformAdminPage: async ({browser},run)=>{const c=await browser.newContext();const x=await create(c,'platform');await run(x.page);expect(x.errors).toEqual([]);await c.close();},
});
export { expect };
export async function expectNoOverflow(page: Page) { expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1); }
