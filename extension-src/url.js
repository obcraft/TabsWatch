// The library key for a page: its address without tracking parameters or #fragment, so the same
// page opened from different links is kept once, while different searches or videos stay apart.
const TRACKING =
  /^(utm_\w+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|igshid|_ga|_gl|ref_src|ref_url|si|spm|ocid|cmpid)$/i;

export function pageKey(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return u.origin + u.pathname + u.search;
  } catch {
    return url;
  }
}
