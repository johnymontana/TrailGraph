import { describe, it, expect } from 'vitest';
import {
  designationKey,
  designationColor,
  designationMatchStops,
  designationDefaultColor,
  designationLegend,
  poiColor,
  poiLegend,
  DESIGNATION_ORDER,
  POI_ORDER,
} from './mapLegend';

describe('designationKey classifier', () => {
  it('buckets the common NPS designations', () => {
    expect(designationKey('National Park')).toBe('park');
    expect(designationKey('National Monument')).toBe('monument');
    expect(designationKey('National Memorial')).toBe('monument');
    expect(designationKey('National Seashore')).toBe('seashore');
    expect(designationKey('National Lakeshore')).toBe('seashore');
    expect(designationKey('National Preserve')).toBe('preserve');
    expect(designationKey('National Recreation Area')).toBe('recreation');
    expect(designationKey('Parkway')).toBe('recreation');
  });

  it('keeps history designations OUT of the park bucket (ordering matters)', () => {
    expect(designationKey('National Historical Park')).toBe('historic');
    expect(designationKey('National Historic Site')).toBe('historic');
    expect(designationKey('National Battlefield')).toBe('historic');
    expect(designationKey('National Military Park')).toBe('historic'); // contains "Park" but is historic
  });

  it('keeps "National Park & Preserve" a park (park rule precedes preserve)', () => {
    expect(designationKey('National Park and Preserve')).toBe('park');
    expect(designationKey('National Park & Preserve')).toBe('park');
  });

  it('is case-insensitive and falls back to "other"', () => {
    expect(designationKey('NATIONAL park')).toBe('park');
    expect(designationKey('National Scenic Trail')).toBe('recreation');
    expect(designationKey('Ecological & Historic Preserve')).toBe('historic'); // historic wins over preserve
    expect(designationKey('Affiliated Area')).toBe('other');
    expect(designationKey('')).toBe('other');
    expect(designationKey(null)).toBe('other');
    expect(designationKey(undefined)).toBe('other');
  });
});

describe('designation colors + legend', () => {
  it('resolves distinct light/dark hex per bucket', () => {
    expect(designationColor('park', 'light')).not.toBe(designationColor('park', 'dark'));
    // The legibility fix: park and monument must not share a color.
    expect(designationColor('park', 'light')).not.toBe(designationColor('monument', 'light'));
  });

  it('match stops exclude the default bucket and pair value→color', () => {
    const stops = designationMatchStops('light');
    expect(stops).not.toContain('other');
    expect(stops.length).toBe((DESIGNATION_ORDER.length - 1) * 2);
    expect(stops[0]).toBe('park');
    expect(stops[1]).toBe(designationColor('park', 'light'));
    expect(designationDefaultColor('light')).toBe(designationColor('other', 'light'));
  });

  it('builds a full legend with a swatch + icon per bucket', () => {
    const legend = designationLegend('dark');
    expect(legend).toHaveLength(DESIGNATION_ORDER.length);
    expect(legend.every((e) => e.color && e.label && e.icon)).toBe(true);
  });
});

describe('POI layer styles (no more green/green, orange/orange)', () => {
  it('gives every POI layer a distinct color', () => {
    const colors = POI_ORDER.map((k) => poiColor(k, 'light'));
    expect(new Set(colors).size).toBe(POI_ORDER.length);
  });
  it('campgrounds is no longer the same as the park pine', () => {
    expect(poiColor('campgrounds', 'light')).not.toBe(designationColor('park', 'light'));
  });
  it('visitor centers and things-to-do differ', () => {
    expect(poiColor('visitorcenters', 'light')).not.toBe(poiColor('thingstodo', 'light'));
  });
  it('legend covers all POI layers', () => {
    expect(poiLegend('light')).toHaveLength(POI_ORDER.length);
  });
});
