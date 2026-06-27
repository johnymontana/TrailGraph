import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
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

  it('campground cards: list/single + the honest degrade/empty states render', () => {
    expect(isRenderableToolOutput('campground_card', { campgrounds: [{}] })).toBe(true);
    expect(isRenderableToolOutput('campground_card', { campground: {} })).toBe(true);
    expect(isRenderableToolOutput('campground_card', { campgrounds: [] })).toBe(false);
    // availability renders even when degraded (no nights) so the deep-link shows
    expect(isRenderableToolOutput('availability_card', { name: 'Canyon', degraded: true, nights: [] })).toBe(true);
    expect(isRenderableToolOutput('availability_card', {})).toBe(false);
    // camp watch renders even empty (confirms state)
    expect(isRenderableToolOutput('camp_watch_card', { watches: [] })).toBe(true);
    expect(isRenderableToolOutput('camp_watch_card', {})).toBe(false);
    expect(isRenderableToolOutput('booking_window_card', { windowOpensOn: '2026-03-15' })).toBe(true);
    // errors always render
    expect(isRenderableToolOutput('availability_card', { error: 'boom' })).toBe(true);
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

  it('graph_result: subgraph, narrated no-result, OR disambiguation chips (#5a)', () => {
    expect(isRenderableToolOutput('graph_result', { nodes: [{}], links: [] })).toBe(true);
    expect(isRenderableToolOutput('graph_result', { narration: 'No connection found.', nodes: [] })).toBe(true);
    expect(isRenderableToolOutput('graph_result', { candidates: [{ intent: 'similar_to', label: 'x' }] })).toBe(true);
    expect(isRenderableToolOutput('graph_result', {})).toBe(false);
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

  it('trail_card: at least one trail; trail_detail_card: id + name', () => {
    expect(isRenderableToolOutput('trail_card', { trails: [{ id: 'nps:zion:angels-landing' }] })).toBe(true);
    expect(isRenderableToolOutput('trail_card', { trails: [] })).toBe(false);
    expect(isRenderableToolOutput('trail_card', {})).toBe(false);
    expect(isRenderableToolOutput('trail_detail_card', { id: 'nps:zion:angels-landing', name: 'Angels Landing' })).toBe(true);
    expect(isRenderableToolOutput('trail_detail_card', { id: 'nps:zion:angels-landing' })).toBe(false); // no name
    expect(isRenderableToolOutput('trail_detail_card', { error: 'No trail found' })).toBe(true); // error always renders
  });

  it('loop_card: renders whenever loops is an array (incl. empty "no loops yet")', () => {
    expect(isRenderableToolOutput('loop_card', { loops: [{ trailIds: ['a', 'b'] }] })).toBe(true);
    expect(isRenderableToolOutput('loop_card', { loops: [] })).toBe(true); // explains "no loops yet"
    expect(isRenderableToolOutput('loop_card', {})).toBe(false);
    expect(isRenderableToolOutput('loop_card', { error: 'pick a park' })).toBe(true); // error always renders
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

  /**
   * Structural guard (anti-drift): the renderability allowlist in tool-output.ts and the `switch (kind)`
   * in components/chat/Cards.tsx are two hand-maintained lists that MUST stay in lock-step for the LEARN
   * (Ranger School Phase 4) cards — a kind that ToolCard renders but the guard rejects is a silently
   * dropped card; the reverse renders an empty shell. Rather than hardcode a list that goes stale, parse
   * the actual `case '<kind>':` lines out of Cards.tsx so this test fails the moment a new learn card is
   * added to the switch without being taught to isRenderableToolOutput.
   */
  describe('structural guard vs components/chat/Cards.tsx', () => {
    // Parse the switch cases from the real Cards.tsx source (node env: fs is available).
    const cardsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../components/chat/Cards.tsx');
    const cardsSrc = readFileSync(cardsPath, 'utf8');
    // Map each `case 'x': return <Component ...>` arm to the component it renders (simple single-return arms).
    const caseComponent = new Map<string, string>();
    for (const m of cardsSrc.matchAll(/case\s+'([a-z_]+)'\s*:\s*return\s+<([A-Za-z0-9]+)/g)) {
      caseComponent.set(m[1], m[2]);
    }
    // The learn-card components are everything DECLARED under the "Ranger School (Phase 4)" section marker —
    // so we discover learn kinds from the real source rather than a hand-kept list that silently goes stale.
    const phase4Idx = cardsSrc.indexOf('Ranger School (Phase 4)');
    const learnComponents = new Set(
      phase4Idx >= 0
        ? [...cardsSrc.slice(phase4Idx).matchAll(/(?:function|const)\s+([A-Z]\w+)/g)].map((m) => m[1])
        : [],
    );
    // Learn kinds = switch cases whose rendered component lives in the Phase-4 section.
    const learnSwitchKinds = [...caseComponent.entries()]
      .filter(([, comp]) => learnComponents.has(comp))
      .map(([kind]) => kind);

    // Minimal renderable payload per learn kind (must mirror the per-kind predicate in tool-output.ts).
    const learnRenderable: Record<string, Record<string, unknown>> = {
      lesson_card: { lessonPlanId: 'lp1' },
      explanation_card: { title: 'Hotspot volcanism' },
      quiz_card: { stem: 'Q?', choices: [{ id: 'a', label: 'A' }] },
      quiz_feedback_card: { correct: true },
      next_step_card: { recommendation: 'advance' },
    };

    it('discovers the learn cards from the parsed switch + Phase-4 section (parse sanity)', () => {
      expect(learnComponents.size).toBeGreaterThan(0); // marker + components found
      // The known core learn kinds must be discovered (guards the parsing itself, not a stale list).
      expect(learnSwitchKinds).toEqual(expect.arrayContaining(['lesson_card', 'quiz_card', 'quiz_feedback_card', 'next_step_card', 'explanation_card']));
    });

    it('every LEARN card kind in the switch has a renderable allowlist entry (and rejects empty data)', () => {
      // Drives off learnSwitchKinds (DERIVED from the source), so a NEW learn case added to Cards.tsx without
      // a fixture + isRenderableToolOutput entry fails here — the real anti-drift guard.
      for (const kind of learnSwitchKinds) {
        expect(learnRenderable, `add a renderable fixture for the new learn card '${kind}'`).toHaveProperty(kind);
        // present in allowlist: a minimal valid payload is accepted (would be `return false` if missing)...
        expect(
          isRenderableToolOutput(kind, learnRenderable[kind]),
          `'${kind}' is rendered by Cards.tsx but missing/false in isRenderableToolOutput`,
        ).toBe(true);
        // ...and empty data is rejected — a real predicate, not a blanket `return true` (empty shell).
        expect(
          isRenderableToolOutput(kind, {}),
          `'${kind}' should reject empty data (avoid rendering an empty shell)`,
        ).toBe(false);
      }
    });
  });

  it("map_snippet is intentionally NOT renderable (recall_learning_context model-context envelope)", () => {
    // recall_learning_context returns a `map_snippet` envelope meant for the model's context window, not
    // a chat card — so it must fall through to `return false` even with a full, valid-looking payload.
    expect(isRenderableToolOutput('map_snippet', { enrolled: [], mastery: [], badges: [] })).toBe(false);
    expect(isRenderableToolOutput('map_snippet', { enrolled: [{ courseId: 'c1' }], mastery: [{ topic: 't', score: 0.8 }] })).toBe(false);
    // ...but the universal error envelope still renders, even for a non-card kind (errors are never dropped).
    expect(isRenderableToolOutput('map_snippet', { error: 'lookup failed' })).toBe(true);
  });
});
