import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Map as MlMap } from 'maplibre-gl';
import { bearingBetween, runFlyThrough, type FlyLeg } from './fly-through';

/** A minimal fake MapLibre map: easeTo fires the pending `moveend` synchronously so a leg resolves at once. */
function fakeMap() {
  const moveend: Array<() => void> = [];
  return {
    easeToCalls: [] as Array<{ center: [number, number]; bearing: number; pitch: number }>,
    jumpToCalls: [] as Array<{ center: [number, number] }>,
    once(ev: string, cb: () => void) {
      if (ev === 'moveend') moveend.push(cb);
    },
    easeTo(camera: { center: [number, number]; bearing: number; pitch: number }) {
      this.easeToCalls.push(camera);
      moveend.shift()?.();
    },
    jumpTo(camera: { center: [number, number] }) {
      this.jumpToCalls.push(camera);
    },
    stop() {},
  };
}
const LEGS: FlyLeg[] = [
  { lng: -110.5, lat: 44.6 },
  { lng: -113.8, lat: 48.7 },
  { lng: -112.1, lat: 36.1 },
];

describe('bearingBetween', () => {
  it('is ~90° (east) along the equator going east', () => {
    expect(bearingBetween([0, 0], [1, 0])).toBeCloseTo(90, 0);
  });
  it('is ~0° (north) going straight up a meridian', () => {
    expect(bearingBetween([0, 0], [0, 1])).toBeCloseTo(0, 0);
  });
  it('is ~270° (west) going west', () => {
    expect(bearingBetween([0, 0], [-1, 0])).toBeCloseTo(270, 0);
  });
  it('is ~180° (south) going down', () => {
    expect(bearingBetween([0, 0], [0, -1])).toBeCloseTo(180, 0);
  });
  it('always returns a value in [0, 360)', () => {
    const b = bearingBetween([-110.5, 44.6], [-110.7, 43.8]); // Yellowstone → Grand Teton (roughly SSW)
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
    expect(b).toBeGreaterThan(180); // heading south-ish
  });
});

describe('runFlyThrough', () => {
  afterEach(() => vi.useRealTimers());

  it('eases the camera to every leg in order, banking toward each next stop', async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const onLeg = vi.fn();
    const p = runFlyThrough(map as unknown as MlMap, LEGS, { onLeg });
    await vi.runAllTimersAsync();
    await p;
    expect(map.easeToCalls.map((c) => c.center)).toEqual([[-110.5, 44.6], [-113.8, 48.7], [-112.1, 36.1]]);
    expect(onLeg).toHaveBeenCalledTimes(3);
    expect(map.easeToCalls[0].bearing).toBe(0); // first leg has no prior stop to bank from
    expect(map.easeToCalls[1].bearing).toBeGreaterThan(0); // subsequent legs bank via bearingBetween
    expect(map.easeToCalls[0].pitch).toBeGreaterThan(0); // pitched (3D-ready) camera
  });

  it('jumps (no animation) when reduced-motion is requested', async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const p = runFlyThrough(map as unknown as MlMap, LEGS, { reduced: true });
    await vi.runAllTimersAsync();
    await p;
    expect(map.jumpToCalls).toHaveLength(3);
    expect(map.easeToCalls).toHaveLength(0);
  });

  it('bails immediately when the signal is already aborted', async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const ac = new AbortController();
    ac.abort();
    const p = runFlyThrough(map as unknown as MlMap, LEGS, { signal: ac.signal });
    await vi.runAllTimersAsync();
    await p;
    expect(map.easeToCalls).toHaveLength(0);
  });

  it('stops mid-tour once aborted (Stop button)', async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const ac = new AbortController();
    // Abort during the first leg's onLeg callback → the post-leg guard returns before leg 2.
    const p = runFlyThrough(map as unknown as MlMap, LEGS, { signal: ac.signal, onLeg: (i) => { if (i === 0) ac.abort(); } });
    await vi.runAllTimersAsync();
    await p;
    expect(map.easeToCalls).toHaveLength(1); // only leg 0 ran
  });

  it('does nothing for an empty / all-unlocated leg list', async () => {
    const map = fakeMap();
    await runFlyThrough(map as unknown as MlMap, []);
    expect(map.easeToCalls).toHaveLength(0);
    expect(map.jumpToCalls).toHaveLength(0);
  });
});
