import { describe, it, expect } from 'vitest';
import { isRenderableToolOutput } from './tool-output';

/**
 * Guards against silent card drops/empties (the review-flagged gap): a wrong predicate either hides a
 * valid card or renders an empty one with no error. One case per kind, both branches.
 */
describe('isRenderableToolOutput', () => {
  it('always renders an error envelope, regardless of kind', () => {
    expect(isRenderableToolOutput('park_card', { error: 'boom' })).toBe(true);
    expect(isRenderableToolOutput('totally_unknown', { error: 'x' })).toBe(true);
  });

  it('park_card: needs parks[] or a single park', () => {
    expect(isRenderableToolOutput('park_card', { parks: [{}] })).toBe(true);
    expect(isRenderableToolOutput('park_card', { park: {} })).toBe(true);
    expect(isRenderableToolOutput('park_card', { parks: [] })).toBe(false);
    expect(isRenderableToolOutput('park_card', {})).toBe(false);
  });

  it('node_results / alert_list: non-empty arrays', () => {
    expect(isRenderableToolOutput('node_results', { results: [{}] })).toBe(true);
    expect(isRenderableToolOutput('node_results', { results: [] })).toBe(false);
    expect(isRenderableToolOutput('alert_list', { parks: [{}] })).toBe(true);
    expect(isRenderableToolOutput('alert_list', { parks: [] })).toBe(false);
  });

  it('itinerary_preview: needs a trip', () => {
    expect(isRenderableToolOutput('itinerary_preview', { trip: { id: 't' } })).toBe(true);
    expect(isRenderableToolOutput('itinerary_preview', {})).toBe(false);
  });

  it('dark_sky_card: any of bortle (incl. 0) / bestMonths / crowd / astro', () => {
    expect(isRenderableToolOutput('dark_sky_card', { bortleScale: 2 })).toBe(true);
    expect(isRenderableToolOutput('dark_sky_card', { bortleScale: 0 })).toBe(true); // 0 != null
    expect(isRenderableToolOutput('dark_sky_card', { bestMonths: 'Jan, Feb' })).toBe(true);
    expect(isRenderableToolOutput('dark_sky_card', { crowdLevel: 'low' })).toBe(true);
    expect(isRenderableToolOutput('dark_sky_card', { astro: {} })).toBe(true);
    expect(isRenderableToolOutput('dark_sky_card', {})).toBe(false);
  });

  it('weather_card / astro_card / conditions_card / trip_dashboard / why_this', () => {
    expect(isRenderableToolOutput('weather_card', { condition: 'Clear' })).toBe(true);
    expect(isRenderableToolOutput('weather_card', { daily: [{}] })).toBe(true);
    expect(isRenderableToolOutput('weather_card', {})).toBe(false);

    expect(isRenderableToolOutput('astro_card', { moon: {} })).toBe(true);
    expect(isRenderableToolOutput('astro_card', { date: '2026-02-01' })).toBe(true);
    expect(isRenderableToolOutput('astro_card', {})).toBe(false);

    expect(isRenderableToolOutput('conditions_card', { parkCode: 'brca' })).toBe(true);
    expect(isRenderableToolOutput('conditions_card', {})).toBe(false);

    expect(isRenderableToolOutput('trip_dashboard', { stops: [{}] })).toBe(true);
    expect(isRenderableToolOutput('trip_dashboard', { stops: [] })).toBe(false);

    expect(isRenderableToolOutput('why_this', { prefPaths: [{}] })).toBe(true);
    expect(isRenderableToolOutput('why_this', { constraints: [{}] })).toBe(true);
    expect(isRenderableToolOutput('why_this', { park: 'Bryce' })).toBe(true);
    expect(isRenderableToolOutput('why_this', {})).toBe(false);
  });

  it('trip_diff: needs both sides; leaderboard_card: entries or a submission', () => {
    expect(isRenderableToolOutput('trip_diff', { a: {}, b: {} })).toBe(true);
    expect(isRenderableToolOutput('trip_diff', { a: {} })).toBe(false);
    expect(isRenderableToolOutput('trip_diff', {})).toBe(false);
    expect(isRenderableToolOutput('leaderboard_card', { entries: [{}] })).toBe(true);
    expect(isRenderableToolOutput('leaderboard_card', { submitted: { sqm: 21 } })).toBe(true);
    expect(isRenderableToolOutput('leaderboard_card', { entries: [] })).toBe(false);
  });

  it('hours_card (F1): state or name; budget_card (F2): at least one park', () => {
    expect(isRenderableToolOutput('hours_card', { state: 'open' })).toBe(true);
    expect(isRenderableToolOutput('hours_card', { name: 'Glacier' })).toBe(true);
    expect(isRenderableToolOutput('hours_card', {})).toBe(false);
    expect(isRenderableToolOutput('budget_card', { parks: [{}] })).toBe(true);
    expect(isRenderableToolOutput('budget_card', { parks: [] })).toBe(false);
    expect(isRenderableToolOutput('accessibility_card', { features: [] })).toBe(true); // renders "none reported"
    expect(isRenderableToolOutput('accessibility_card', { name: 'Glacier' })).toBe(true);
    expect(isRenderableToolOutput('accessibility_card', {})).toBe(false);
    expect(isRenderableToolOutput('news_card', { news: [] })).toBe(true); // renders "no recent news"
    expect(isRenderableToolOutput('news_card', {})).toBe(false);
    expect(isRenderableToolOutput('media_card', { audio: [{}] })).toBe(true); // F6
    expect(isRenderableToolOutput('media_card', { videos: [{}] })).toBe(true);
    expect(isRenderableToolOutput('media_card', { audio: [], videos: [], galleries: [] })).toBe(false);
    expect(isRenderableToolOutput('media_card', { error: 'none' })).toBe(true); // error always renders
  });

  it('question_card: needs a prompt and at least one option', () => {
    expect(isRenderableToolOutput('question_card', { prompt: 'Pick one', options: [{}] })).toBe(true);
    expect(isRenderableToolOutput('question_card', { prompt: 'Pick one', options: [] })).toBe(false);
    expect(isRenderableToolOutput('question_card', { options: [{}] })).toBe(false);
    expect(isRenderableToolOutput('question_card', {})).toBe(false);
  });

  it('unknown kinds render nothing; null data is safe', () => {
    expect(isRenderableToolOutput('map_snippet', { foo: 1 })).toBe(false);
    expect(isRenderableToolOutput('park_card', null)).toBe(false);
    expect(isRenderableToolOutput('why_this', undefined)).toBe(false);
  });

  it('Ranger School (Phase 4) tutor cards', () => {
    // lesson_card: a course list, an enrolled spine, or just an id all render; empty does not
    expect(isRenderableToolOutput('lesson_card', { courses: [{}] })).toBe(true);
    expect(isRenderableToolOutput('lesson_card', { modules: [] })).toBe(true); // array present = render (shows progress)
    expect(isRenderableToolOutput('lesson_card', { lessonPlanId: 'lp1' })).toBe(true);
    expect(isRenderableToolOutput('lesson_card', {})).toBe(false);
    // explanation_card
    expect(isRenderableToolOutput('explanation_card', { title: 'Hotspot' })).toBe(true);
    expect(isRenderableToolOutput('explanation_card', { objective: 'x' })).toBe(true);
    expect(isRenderableToolOutput('explanation_card', {})).toBe(false);
    // quiz_card requires a stem + at least one choice (anti-empty)
    expect(isRenderableToolOutput('quiz_card', { stem: 'Q?', choices: [{ id: 'a', label: 'A' }] })).toBe(true);
    expect(isRenderableToolOutput('quiz_card', { stem: 'Q?', choices: [] })).toBe(false);
    expect(isRenderableToolOutput('quiz_card', { choices: [{ id: 'a' }] })).toBe(false);
    // quiz_feedback_card renders on a boolean correct (true OR false)
    expect(isRenderableToolOutput('quiz_feedback_card', { correct: false })).toBe(true);
    expect(isRenderableToolOutput('quiz_feedback_card', { correct: true })).toBe(true);
    expect(isRenderableToolOutput('quiz_feedback_card', {})).toBe(false);
    // next_step_card
    expect(isRenderableToolOutput('next_step_card', { recommendation: 'advance' })).toBe(true);
    expect(isRenderableToolOutput('next_step_card', {})).toBe(false);
  });
});
