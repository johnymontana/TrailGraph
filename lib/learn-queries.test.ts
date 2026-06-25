import { describe, it, expect, vi } from 'vitest';

// Pure-logic test: stub I/O so importing the module never touches a driver or the queries layer.
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./queries', () => ({ lessonPlanContext: vi.fn() }));

import {
  quizDifficultyForMastery,
  toFulltextQuery,
  gradeBandRange,
  crossParkTopics,
  learningTrailForTopic,
  masteryByTopic,
  learnCatalog,
  searchCourses,
  quizForClient,
  getLearningMemory,
  lessonPlanProgress,
  pickQuizForLesson,
  recentQuizIdsForLesson,
  certificateBySlug,
  getLearnDashboard,
  quizGradeData,
  lessonContent,
} from './learn-queries';
import { readGraph } from './neo4j';
import { lessonPlanContext } from './queries';

const readGraphMock = vi.mocked(readGraph);
const lessonPlanContextMock = vi.mocked(lessonPlanContext);

/** Every `$param` the Cypher references must be a key in the params object the call supplies — the
 * exact class of bug (a referenced-but-unbound param → neo4j-driver "Expected parameter(s)") that
 * typecheck/build can't see. Asserts on the recorded readGraph(cypher, params) call args. */
function expectAllParamsBound(callIndex = 0): void {
  const [cypher, params] = readGraphMock.mock.calls[callIndex] as [string, Record<string, unknown> | undefined];
  const referenced = new Set([...cypher.matchAll(/\$(\w+)/g)].map((m) => m[1]));
  for (const name of referenced) {
    expect(params, `param $${name} referenced but no params object passed`).toBeDefined();
    expect(Object.keys(params ?? {}), `param $${name} referenced but not bound`).toContain(name);
  }
}

describe('gradeBandRange (catalog grade filter)', () => {
  it('maps known bands to [min,max], case-insensitive', () => {
    expect(gradeBandRange('k-2')).toEqual([0, 2]);
    expect(gradeBandRange('3-5')).toEqual([3, 5]);
    expect(gradeBandRange('6-8')).toEqual([6, 8]);
    expect(gradeBandRange('9-12')).toEqual([9, 12]);
    expect(gradeBandRange('K-2')).toEqual([0, 2]);
  });
  it('returns null for empty / unknown bands', () => {
    expect(gradeBandRange('')).toBeNull();
    expect(gradeBandRange(null)).toBeNull();
    expect(gradeBandRange(undefined)).toBeNull();
    expect(gradeBandRange('grad-school')).toBeNull();
  });
});

describe('toFulltextQuery (catalog search sanitizer)', () => {
  it('lowercases + prefix-wildcards each term', () => {
    expect(toFulltextQuery('Yellowstone Geology')).toBe('yellowstone* geology*');
    expect(toFulltextQuery('  wildlife  ')).toBe('wildlife*');
  });
  it('strips Lucene-operator / punctuation injection (no special chars survive)', () => {
    expect(toFulltextQuery('geology!')).toBe('geology*');
    expect(toFulltextQuery('a AND b OR (c)~*')).toBe('a* and* b* or* c*');
    expect(toFulltextQuery('"quoted" -term')).toBe('quoted* term*');
  });
  it('returns empty for an empty / punctuation-only query (caller falls back to the catalog)', () => {
    expect(toFulltextQuery('')).toBe('');
    expect(toFulltextQuery('   ')).toBe('');
    expect(toFulltextQuery('!@#$%^&*()')).toBe('');
  });
});

describe('cross-park trail reads bind every referenced Cypher param', () => {
  it('crossParkTopics passes { limit } (default + explicit)', async () => {
    readGraphMock.mockResolvedValue([]);
    readGraphMock.mockClear();
    await crossParkTopics(10);
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    expect(readGraphMock.mock.calls[0][1]).toEqual({ limit: 10 });
    expectAllParamsBound();

    readGraphMock.mockClear();
    await crossParkTopics(); // default 12
    expect(readGraphMock.mock.calls[0][1]).toEqual({ limit: 12 });
    expectAllParamsBound();
  });

  it('learningTrailForTopic passes { topic }', async () => {
    readGraphMock.mockResolvedValue([]);
    readGraphMock.mockClear();
    await learningTrailForTopic('Geology');
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    expect(readGraphMock.mock.calls[0][1]).toEqual({ topic: 'Geology' });
    expectAllParamsBound();
  });
});

describe('quizDifficultyForMastery (adaptive difficulty)', () => {
  it('starts gentle for an unseen topic', () => {
    expect(quizDifficultyForMastery(null)).toBe('easy');
    expect(quizDifficultyForMastery(undefined)).toBe('easy');
  });
  it('low mastery → easy, mid → medium, high → hard', () => {
    expect(quizDifficultyForMastery(0)).toBe('easy');
    expect(quizDifficultyForMastery(0.59)).toBe('easy');
    expect(quizDifficultyForMastery(0.6)).toBe('medium');
    expect(quizDifficultyForMastery(0.8)).toBe('medium');
    expect(quizDifficultyForMastery(0.81)).toBe('hard');
    expect(quizDifficultyForMastery(1)).toBe('hard');
  });
});

describe('masteryByTopic (rolling correctness window)', () => {
  it('binds null lessonPlanId + default window 10 when scope/window omitted', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await masteryByTopic('u1');
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    expect(readGraphMock.mock.calls[0][1]).toEqual({ userId: 'u1', lessonPlanId: null, windowSize: 10 });
    expectAllParamsBound(); // confirms $windowSize / $lessonPlanId are bound, not just referenced
  });

  it('binds the explicit lessonPlanId + windowSize', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await masteryByTopic('u1', 'lp1', 5);
    expect(readGraphMock.mock.calls[0][1]).toEqual({ userId: 'u1', lessonPlanId: 'lp1', windowSize: 5 });
    expectAllParamsBound();
  });
});

describe('learnCatalog (grade-band filter binding)', () => {
  it('binds null band range when no grade band given (default limit 60)', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await learnCatalog();
    expect(readGraphMock.mock.calls[0][1]).toEqual({ limit: 60, skip: 0, bandMin: null, bandMax: null, subject: null });
    expectAllParamsBound();
  });

  it('binds the resolved [min,max] for a known band', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await learnCatalog(20, '6-8');
    expect(readGraphMock.mock.calls[0][1]).toEqual({ limit: 20, skip: 0, bandMin: 6, bandMax: 8, subject: null });
    expectAllParamsBound();
  });

  it('binds null band range for an unknown band (no filter, not an empty result)', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await learnCatalog(60, 'bogus');
    expect(readGraphMock.mock.calls[0][1]).toEqual({ limit: 60, skip: 0, bandMin: null, bandMax: null, subject: null });
    expectAllParamsBound();
  });
});

describe('searchCourses (fulltext vs catalog fallback)', () => {
  it('whitespace-only query falls back to learnCatalog (no fulltext index call), forwarding the grade band', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await searchCourses('   ', { gradeBand: '6-8' });
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    const [cypher, params] = readGraphMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).not.toContain('db.index.fulltext');
    expect(params).toEqual({ limit: 60, skip: 0, bandMin: 6, bandMax: 8, subject: null });
    expectAllParamsBound();
  });

  it('punctuation-only query falls back to learnCatalog (no fulltext index call)', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await searchCourses('!@#');
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    const [cypher, params] = readGraphMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).not.toContain('db.index.fulltext');
    expect(params).toEqual({ limit: 60, skip: 0, bandMin: null, bandMax: null, subject: null });
    expectAllParamsBound();
  });

  it('real query runs the fulltext index with the sanitized prefix query', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await searchCourses('Yellowstone Geology');
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    const [cypher, params] = readGraphMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain('db.index.fulltext.queryNodes');
    expect(params).toEqual({ ft: 'yellowstone* geology*', limit: 60, skip: 0, bandMin: null, bandMax: null, subject: null });
    expectAllParamsBound();
  });
});

describe('quizForClient (anti-cheat client read)', () => {
  it('returns null when the quiz row is missing', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    expect(await quizForClient('q-missing')).toBeNull();
    expect(readGraphMock.mock.calls[0][1]).toEqual({ quizId: 'q-missing' });
    expectAllParamsBound();
  });

  it('returns null when choices JSON is malformed', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([
      { id: 'q1', stem: 'Why?', choices: 'not json', difficulty: 'easy', lessonId: 'l1' },
    ] as never);
    expect(await quizForClient('q1')).toBeNull();
  });

  it('returns null when choices parse to an empty array', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([
      { id: 'q1', stem: 'Why?', choices: '[]', difficulty: 'easy', lessonId: 'l1' },
    ] as never);
    expect(await quizForClient('q1')).toBeNull();
  });

  it('filters malformed choices and strips correctId/rationale', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([
      {
        id: 'q1',
        stem: 'Why?',
        choices: '[{"id":"a","label":"A"},{"bad":1},{"id":"b","label":"B"}]',
        difficulty: 'medium',
        lessonId: 'l1',
        // anti-cheat: even if the DB row leaked these, the client read must not surface them
        correctId: 'a',
        rationale: 'because A',
      },
    ] as never);
    const quiz = await quizForClient('q1');
    expect(quiz).toEqual({
      id: 'q1',
      stem: 'Why?',
      choices: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      difficulty: 'medium',
      lessonId: 'l1',
    });
    // exact key set — no correctId/rationale leaked
    expect(Object.keys(quiz ?? {}).sort()).toEqual(['choices', 'difficulty', 'id', 'lessonId', 'stem']);
  });
});

describe('getLearningMemory (full learner state, placeholder filtering)', () => {
  it('returns EMPTY_LEARNING for a cold-start user (no :User row)', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    const mem = await getLearningMemory('u-cold');
    expect(mem).toEqual({
      enrolled: [],
      completedLessons: [],
      struggling: [],
      mastery: [],
      badges: [],
      certificates: [],
    });
    expect(readGraphMock.mock.calls[0][1]).toEqual({ userId: 'u-cold' });
    expectAllParamsBound();
  });

  it('filters OPTIONAL-MATCH null placeholders, keeping only real entries', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([
      {
        enrolled: [{ id: null, title: null }, { id: 'lp1', title: 'Geology 101' }],
        completedLessons: [{ id: null, title: null, score: null }, { id: 'l1', title: 'Intro', score: 0.9 }],
        struggling: [{ topic: null, confidence: null }, { topic: 'Volcanoes', confidence: 0.3 }],
        mastery: [{ topic: null, score: null }, { topic: 'Rivers', score: 0.85 }],
        badges: [{ id: null, label: null, tier: null }, { id: 'b1', label: 'Ranger', tier: 'gold' }],
        certificates: [
          { lessonPlanId: null, courseTitle: null, shareSlug: null, score: null, issuedAt: null },
          { lessonPlanId: 'lp1', courseTitle: 'Geology 101', shareSlug: 'abc', score: 0.95, issuedAt: '2026-01-01' },
        ],
      },
    ] as never);
    const mem = await getLearningMemory('u1');
    expect(mem.enrolled).toEqual([{ id: 'lp1', title: 'Geology 101' }]);
    expect(mem.completedLessons).toEqual([{ id: 'l1', title: 'Intro', score: 0.9 }]);
    expect(mem.struggling).toEqual([{ topic: 'Volcanoes', confidence: 0.3 }]);
    expect(mem.mastery).toEqual([{ topic: 'Rivers', score: 0.85 }]);
    expect(mem.badges).toEqual([{ id: 'b1', label: 'Ranger', tier: 'gold' }]);
    expect(mem.certificates).toEqual([
      { lessonPlanId: 'lp1', courseTitle: 'Geology 101', shareSlug: 'abc', score: 0.95, issuedAt: '2026-01-01' },
    ]);
  });

  it('coalesces undefined collected arrays to []', async () => {
    readGraphMock.mockReset();
    // A row present (so not cold-start) but every collected list absent.
    readGraphMock.mockResolvedValue([{}] as never);
    const mem = await getLearningMemory('u1');
    expect(mem).toEqual({
      enrolled: [],
      completedLessons: [],
      struggling: [],
      mastery: [],
      badges: [],
      certificates: [],
    });
  });
});

describe('lessonPlanProgress (TS ordering + done/total)', () => {
  it('returns null when the lesson plan does not exist', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    expect(await lessonPlanProgress('u1', 'lp-missing')).toBeNull();
    expect(readGraphMock.mock.calls[0][1]).toEqual({ userId: 'u1', lessonPlanId: 'lp-missing' });
    expectAllParamsBound();
  });

  it('sorts modules + lessons by ordinal and recomputes done/total in TS', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([
      {
        title: 'Geology 101',
        modules: [
          {
            id: 'm2',
            ordinal: 2,
            title: 'Second',
            lessons: [
              { id: 'l4', ordinal: 4, title: 'L4', completed: false },
              { id: 'l3', ordinal: 3, title: 'L3', completed: true },
            ],
          },
          {
            id: 'm1',
            ordinal: 1,
            title: 'First',
            lessons: [
              { id: 'l2', ordinal: 2, title: 'L2', completed: false },
              { id: 'l1', ordinal: 1, title: 'L1', completed: true },
            ],
          },
        ],
      },
    ] as never);
    const prog = await lessonPlanProgress('u1', 'lp1');
    expect(prog).not.toBeNull();
    expect(prog!.title).toBe('Geology 101');
    expect(prog!.modules.map((m) => m.id)).toEqual(['m1', 'm2']); // sorted ascending
    expect(prog!.modules[0].lessons.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(prog!.modules[1].lessons.map((l) => l.id)).toEqual(['l3', 'l4']);
    expect(prog!.total).toBe(4);
    expect(prog!.done).toBe(2); // l1 + l3 completed
  });
});

describe('pickQuizForLesson (cached quiz pick)', () => {
  it('binds difficulty null when omitted', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await pickQuizForLesson('l1');
    expect(readGraphMock.mock.calls[0][1]).toEqual({ lessonId: 'l1', difficulty: null, excludeIds: [] });
    expectAllParamsBound();
  });

  it('binds the explicit difficulty', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await pickQuizForLesson('l1', 'hard');
    expect(readGraphMock.mock.calls[0][1]).toEqual({ lessonId: 'l1', difficulty: 'hard', excludeIds: [] });
    expectAllParamsBound();
  });

  it('returns null on missing rows', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    expect(await pickQuizForLesson('l1')).toBeNull();
  });

  it('returns null when choices are unparseable', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([
      { id: 'q1', stem: 'Why?', choices: 'garbage', difficulty: 'easy' },
    ] as never);
    expect(await pickQuizForLesson('l1')).toBeNull();
  });

  it('sets lessonId from the passed argument (not the DB row, which omits it)', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([
      { id: 'q1', stem: 'Why?', choices: '[{"id":"a","label":"A"}]', difficulty: 'easy' },
    ] as never);
    const quiz = await pickQuizForLesson('l-arg');
    expect(quiz).toEqual({
      id: 'q1',
      stem: 'Why?',
      choices: [{ id: 'a', label: 'A' }],
      difficulty: 'easy',
      lessonId: 'l-arg',
    });
  });

  it('filters excludeIds in the query and binds them (default [])', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await pickQuizForLesson('l1', 'easy', ['q-old']);
    const [cypher, params] = readGraphMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain('NOT q.id IN $excludeIds');
    expect(params).toEqual({ lessonId: 'l1', difficulty: 'easy', excludeIds: ['q-old'] });
    expectAllParamsBound();

    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    await pickQuizForLesson('l1');
    expect(readGraphMock.mock.calls[0][1]).toEqual({ lessonId: 'l1', difficulty: null, excludeIds: [] });
  });
});

describe('recentQuizIdsForLesson', () => {
  it('returns the answered quiz ids newest-first and binds { userId, lessonId, limit }', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([{ id: 'q2' }, { id: 'q1' }] as never);
    const ids = await recentQuizIdsForLesson('u1', 'l1', 3);
    expect(ids).toEqual(['q2', 'q1']);
    expect(readGraphMock.mock.calls[0][1]).toEqual({ userId: 'u1', lessonId: 'l1', limit: 3 });
    expectAllParamsBound();
  });
});

describe('certificateBySlug / getLearnDashboard / quizGradeData (binding + empty defaults)', () => {
  it('certificateBySlug returns null + binds { slug } on empty rows', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    expect(await certificateBySlug('s')).toBeNull();
    expect(readGraphMock.mock.calls[0][1]).toEqual({ slug: 's' });
    expectAllParamsBound();
  });

  it('getLearnDashboard returns the zeroed default on empty rows', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    expect(await getLearnDashboard('u')).toEqual({ enrolled: 0, completedLessons: 0, badges: 0 });
    expect(readGraphMock.mock.calls[0][1]).toEqual({ userId: 'u' });
    expectAllParamsBound();
  });

  it('quizGradeData returns null + binds { quizId } on empty rows', async () => {
    readGraphMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    expect(await quizGradeData('q')).toBeNull();
    expect(readGraphMock.mock.calls[0][1]).toEqual({ quizId: 'q' });
    expectAllParamsBound();
  });
});

describe('lessonContent (lesson + module + park context)', () => {
  it('returns null and does NOT call lessonPlanContext when the lesson is missing', async () => {
    readGraphMock.mockReset();
    lessonPlanContextMock.mockReset();
    readGraphMock.mockResolvedValue([]);
    expect(await lessonContent('l-missing')).toBeNull();
    expect(readGraphMock.mock.calls[0][1]).toEqual({ lessonId: 'l-missing' });
    expectAllParamsBound();
    expect(lessonPlanContextMock).not.toHaveBeenCalled();
  });

  it('returns context:null and skips lessonPlanContext for an orphan lesson (no module/plan)', async () => {
    readGraphMock.mockReset();
    lessonPlanContextMock.mockReset();
    readGraphMock.mockResolvedValue([
      {
        lessonId: 'l1',
        lessonOrdinal: 1,
        lessonTitle: 'Intro',
        durationMin: 30,
        moduleId: null,
        moduleOrdinal: null,
        moduleTitle: null,
        moduleSummary: null,
        lessonPlanId: null,
      },
    ] as never);
    const content = await lessonContent('l1');
    expect(content).not.toBeNull();
    expect(content!.context).toBeNull();
    expect(content!.lessonPlanId).toBeNull();
    expect(content!.lesson).toEqual({ id: 'l1', ordinal: 1, title: 'Intro', durationMin: 30 });
    expect(lessonPlanContextMock).not.toHaveBeenCalled();
  });

  it('invokes lessonPlanContext once with (lessonPlanId, window) when the lesson has a plan', async () => {
    readGraphMock.mockReset();
    lessonPlanContextMock.mockReset();
    readGraphMock.mockResolvedValue([
      {
        lessonId: 'l1',
        lessonOrdinal: 2,
        lessonTitle: 'Eruptions',
        durationMin: null,
        moduleId: 'm1',
        moduleOrdinal: 1,
        moduleTitle: 'Volcanoes',
        moduleSummary: 'about volcanoes',
        lessonPlanId: 'lp1',
      },
    ] as never);
    const ctxStub = { park: null } as never;
    lessonPlanContextMock.mockResolvedValue(ctxStub);
    const window = { start: '2026-07-01', end: '2026-07-10' };
    const content = await lessonContent('l1', window);
    expect(lessonPlanContextMock).toHaveBeenCalledTimes(1);
    expect(lessonPlanContextMock).toHaveBeenCalledWith('lp1', window);
    expect(content!.context).toBe(ctxStub);
    expect(content!.module).toEqual({ id: 'm1', ordinal: 1, title: 'Volcanoes', summary: 'about volcanoes' });
    expect(content!.lessonPlanId).toBe('lp1');
  });
});
