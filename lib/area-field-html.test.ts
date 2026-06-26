import { describe, it, expect } from 'vitest';
import { areaFieldHtml } from './area-field-html';
import type { AreaBrief } from './area-pack';

const base: AreaBrief = {
  box: { minLat: 44, minLng: -111, maxLat: 45, maxLng: -110 },
  parks: [],
  pois: [],
  boundaries: [],
  layers: [],
  capped: { parks: false, boundaries: false },
};

describe('areaFieldHtml', () => {
  it('renders a park with designation, coords, flags, and nearby POI counts', () => {
    const html = areaFieldHtml({
      ...base,
      parks: [{ parkCode: 'yell', name: 'Yellowstone', designation: 'National Park', lat: 44.6, lng: -110.5, darkSky: true, accessible: false, feeFree: true }],
      pois: [
        { layer: 'campgrounds', name: 'Madison', lat: 44.6, lng: -110.8, parkCode: 'yell' },
        { layer: 'campgrounds', name: 'Norris', lat: 44.7, lng: -110.7, parkCode: 'yell' },
        { layer: 'visitorcenters', name: 'Old Faithful VC', lat: 44.4, lng: -110.8, parkCode: 'yell' },
      ],
    });
    expect(html).toContain('Yellowstone');
    expect(html).toContain('National Park');
    expect(html).toContain('44.60000, -110.50000');
    expect(html).toContain('Dark sky');
    expect(html).toContain('Fee-free');
    expect(html).not.toContain('Accessible'); // false flag omitted
    expect(html).toContain('2 campgrounds');
    expect(html).toContain('1 visitor centers');
  });

  it('escapes HTML in park names (no injection via NPS text)', () => {
    const html = areaFieldHtml({ ...base, parks: [{ parkCode: 'x', name: '<script>alert(1)</script>', designation: null, lat: 1, lng: 2 }] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows an empty-state when no parks are in view', () => {
    const html = areaFieldHtml(base);
    expect(html).toContain('No parks in this area');
    expect(html).toContain('0 parks in view');
  });

  it('notes truncation when the parks were capped', () => {
    const html = areaFieldHtml({ ...base, parks: [{ parkCode: 'a', name: 'A', designation: null, lat: 1, lng: 2 }], capped: { parks: true, boundaries: false } });
    expect(html).toContain('first 60 parks');
  });
});
