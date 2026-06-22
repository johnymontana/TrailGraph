/**
 * US state/territory code → name. Used to populate `:State.name` during NPS sync (the park sync only
 * had the 2-letter code, so park-detail state names rendered as ", ," — §2.8).
 */
export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands',
};

export function stateName(code: string): string {
  return STATE_NAMES[code?.toUpperCase()] ?? code;
}

/**
 * Common US region phrases → state codes, so the ranger can narrow thematic searches by region
 * (R4 §2.3). Keyed lowercased; `regionStates` also matches when a key is contained in the phrase.
 */
export const REGION_STATES: Record<string, string[]> = {
  'pacific northwest': ['WA', 'OR', 'ID'],
  pnw: ['WA', 'OR', 'ID'],
  'desert southwest': ['AZ', 'UT', 'NM', 'NV', 'CA'],
  southwest: ['AZ', 'UT', 'NM', 'NV'],
  'four corners': ['AZ', 'UT', 'CO', 'NM'],
  'rocky mountains': ['CO', 'MT', 'WY', 'ID', 'UT'],
  rockies: ['CO', 'MT', 'WY', 'ID', 'UT'],
  'sierra nevada': ['CA', 'NV'],
  california: ['CA'],
  'new england': ['ME', 'NH', 'VT', 'MA', 'RI', 'CT'],
  northeast: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA'],
  southeast: ['FL', 'GA', 'SC', 'NC', 'TN', 'AL', 'MS', 'KY', 'VA', 'WV', 'AR', 'LA'],
  appalachia: ['WV', 'VA', 'KY', 'TN', 'NC', 'PA'],
  'great lakes': ['MI', 'WI', 'MN', 'OH', 'IL', 'IN'],
  midwest: ['OH', 'MI', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO', 'ND', 'SD', 'NE', 'KS'],
  'great plains': ['ND', 'SD', 'NE', 'KS', 'OK', 'TX'],
  alaska: ['AK'],
  hawaii: ['HI'],
};

/** Resolve a region phrase (or state name) to state codes. Pure (unit-tested). */
export function regionStates(region: string | null | undefined): string[] {
  if (!region) return [];
  const q = region.trim().toLowerCase();
  if (REGION_STATES[q]) return REGION_STATES[q];
  for (const [key, codes] of Object.entries(REGION_STATES)) if (q.includes(key)) return codes;
  // Fall back to a state name → code (e.g. "Washington" → WA).
  const byName = Object.entries(STATE_NAMES).find(([, name]) => name.toLowerCase() === q);
  return byName ? [byName[0]] : [];
}
