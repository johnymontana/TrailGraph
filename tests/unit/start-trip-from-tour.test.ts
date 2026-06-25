import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P1.3 confirm-before-save for tours. `defineTool(def)` returns `def`, so `execute(input, ctx)` is directly
 * callable; we stub the lib deps to test the tool's ORCHESTRATION — that an unconfirmed call shows a draft
 * and writes NOTHING, and only `confirmed:true` persists via createTripFromTour.
 */
vi.mock('eve/tools', () => ({ defineTool: (def: unknown) => def }));
vi.mock('../../lib/agent-ctx', () => ({ callerId: vi.fn(() => 'u1') }));
vi.mock('../../lib/trips', () => ({
  createTripFromTour: vi.fn(),
  getTrip: vi.fn(),
  previewTourFromTour: vi.fn(),
}));
vi.mock('../../lib/queries', () => ({ toursForPark: vi.fn() }));

import * as trips from '../../lib/trips';
import * as queries from '../../lib/queries';
import startTripFromTour from '../../agent/tools/start_trip_from_tour';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (input: unknown) => (startTripFromTour as any).execute(input, {} as never);

beforeEach(() => vi.clearAllMocks());

describe('start_trip_from_tour confirm gate (P1.3)', () => {
  it('without confirmed: returns a saveable DRAFT carrying tourId, and writes NOTHING', async () => {
    vi.mocked(trips.previewTourFromTour).mockResolvedValue({
      name: 'Canyon Rim Tour (tour)',
      stops: [{ name: 'Artist Point' }, { name: 'Canyon Visitor Center' }],
    });
    const out = await exec({ tourId: 'tour-canyon-rim' });
    expect(out.kind).toBe('itinerary_preview');
    expect(out.data.draft).toBe(true);
    expect(out.data.fromTour).toBe(true);
    expect(out.data.tourId).toBe('tour-canyon-rim'); // so the agreement call can re-use it
    expect(out.data.trip.stops).toHaveLength(2);
    expect(trips.previewTourFromTour).toHaveBeenCalledWith('tour-canyon-rim');
    expect(trips.createTripFromTour).not.toHaveBeenCalled(); // the whole point: no write on a proposal
  });

  it('with confirmed: persists via createTripFromTour and returns the saved (non-draft) trip', async () => {
    vi.mocked(trips.createTripFromTour).mockResolvedValue({ tripId: 't1', name: 'Canyon Rim Tour (tour)', stops: 2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(trips.getTrip).mockResolvedValue({ id: 't1', name: 'Canyon Rim Tour (tour)', stops: [{}, {}] } as any);
    const out = await exec({ tourId: 'tour-canyon-rim', confirmed: true });
    expect(trips.createTripFromTour).toHaveBeenCalledWith('u1', 'tour-canyon-rim');
    expect(out.data.draft).toBeUndefined();
    expect(out.data.fromTour).toBe(true);
    expect(out.data.trip.id).toBe('t1');
    expect(trips.previewTourFromTour).not.toHaveBeenCalled(); // confirmed path skips the preview read
  });

  it('resolves a parkCode to its richest tour when no tourId is given', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(queries.toursForPark).mockResolvedValue([{ id: 'tour-canyon-rim' }] as any);
    vi.mocked(trips.previewTourFromTour).mockResolvedValue({ name: 'X (tour)', stops: [{ name: 'A' }] });
    const out = await exec({ parkCode: 'yell' });
    expect(queries.toursForPark).toHaveBeenCalledWith('yell', 1);
    expect(trips.previewTourFromTour).toHaveBeenCalledWith('tour-canyon-rim');
    expect(out.data.tourId).toBe('tour-canyon-rim');
  });

  it('errors (no write) when no tour can be found', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(queries.toursForPark).mockResolvedValue([] as any);
    const out = await exec({ parkCode: 'nope' });
    expect(out.data.error).toMatch(/no tour/i);
    expect(trips.previewTourFromTour).not.toHaveBeenCalled();
    expect(trips.createTripFromTour).not.toHaveBeenCalled();
  });

  it('errors when the tour has no usable stops (preview returns null)', async () => {
    vi.mocked(trips.previewTourFromTour).mockResolvedValue(null);
    const out = await exec({ tourId: 'empty-tour' });
    expect(out.data.error).toMatch(/stops/i);
    expect(trips.createTripFromTour).not.toHaveBeenCalled();
  });

  it('confirmed but createTripFromTour returns null → error, and does not read the trip back', async () => {
    vi.mocked(trips.createTripFromTour).mockResolvedValue(null);
    const out = await exec({ tourId: 'tour-canyon-rim', confirmed: true });
    expect(out.data.error).toMatch(/stops/i);
    expect(trips.getTrip).not.toHaveBeenCalled();
  });
});
