// Shared client state: the brand list and the active brand (remembered per browser; a convenience, not a source of truth).
import { get } from './api.js';
export const state = { brands: [], brandId: null, accounts: [] };
const KEY = 'cadence.brand';
export function setBrand(id) { state.brandId = id; try { localStorage.setItem(KEY, id || ''); } catch { /* private mode */ } window.dispatchEvent(new Event('cadence:brand')); }
export const brand = () => state.brands.find((b) => b.id === state.brandId) || null;
export async function loadBrands() {
  state.brands = await get('/api/brands');
  let saved = ''; try { saved = localStorage.getItem(KEY) || ''; } catch { /* ignore */ }
  if (!state.brands.some((b) => b.id === state.brandId)) state.brandId = state.brands.find((b) => b.id === saved)?.id || state.brands[0]?.id || null;
  return state.brands;
}
export async function loadAccounts() { state.accounts = await get('/api/accounts'); return state.accounts; }
