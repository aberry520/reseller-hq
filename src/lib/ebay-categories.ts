// eBay category search from the bundled tree (ebay-categories-data.ts),
// extracted from eBay's 2026 category-changes preview page. Stopgap until
// the Taxonomy API (getCategorySuggestions) is wired up — that needs an
// eBay developer account. Only LEAF categories are returned: eBay only
// accepts leaf category IDs for listings, so parent nodes are never
// offered as a pick.

import { EBAY_CATEGORY_TREE, EbayCategoryNode } from './ebay-categories-data';

export interface EbayCategory {
  id: string;
  name: string;
  path: string; // full breadcrumb, e.g. "Home & Garden > ... > Lawn Mowers"
}

let leafCache: EbayCategory[] | null = null;

function flatten(nodes: EbayCategoryNode[], prefix: string, out: EbayCategory[]): void {
  for (const [name, id, children] of nodes) {
    const path = prefix ? `${prefix} > ${name}` : name;
    if (children && children.length > 0) {
      flatten(children, path, out);
    } else if (id) {
      out.push({ id, name, path });
    }
  }
}

/** All leaf categories (eBay-listable), flattened from the tree. Cached. */
export function allLeafCategories(): EbayCategory[] {
  if (!leafCache) {
    leafCache = [];
    flatten(EBAY_CATEGORY_TREE, '', leafCache);
  }
  return leafCache;
}

/**
 * Search leaf categories by keyword. Matches if every word in the query
 * appears somewhere in the full path (case-insensitive). Results are
 * ranked: exact leaf-name matches first, then shorter paths. Returns at
 * most `limit` matches.
 */
export function searchEbayCategories(query: string, limit = 50): EbayCategory[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const all = allLeafCategories();
  const scored: { cat: EbayCategory; score: number }[] = [];
  for (const cat of all) {
    const hay = cat.path.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    // Exact leaf-name match ranks first; then prefer shorter paths.
    const leaf = cat.name.toLowerCase();
    const exact = words.every((w) => leaf.includes(w)) ? 0 : 1;
    scored.push({ cat, score: exact * 1000 + cat.path.length });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.cat);
}

/** Look up a category by ID (for showing the saved category's path). */
export function ebayCategoryById(id: string): EbayCategory | null {
  if (!id) return null;
  return allLeafCategories().find((c) => c.id === id) ?? null;
}
