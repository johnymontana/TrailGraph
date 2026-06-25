import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// Pure-logic test: stub the I/O deps so importing the module never touches a driver or the gateway.
vi.mock('../neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('../generate', () => ({ generateJson: vi.fn() }));

import { buildCourseSpine, decomposeLessons, type GenCourse } from './decompose-lessons';
import { readGraph, writeGraph } from '../neo4j';
import { generateJson } from '../generate';

const mRead = vi.mocked(readGraph);
const mWrite = vi.mocked(writeGraph);
const mGen = vi.mocked(generateJson);

const HASH = 'abc123';

const validCourse: GenCourse = {
  modules: [
    {
      title: 'Hotspot & Caldera',
      summary: 'How the hotspot built the caldera.',
      lessons: [
        {
          title: 'The Yellowstone Hotspot',
          durationMin: 15,
          quiz: {
            stem: 'What drives the geysers?',
            choices: [
              { id: 'a', label: 'A mantle hotspot' },
              { id: 'b', label: 'Glaciers' },
              { id: 'c', label: 'A meteor' },
            ],
            correctId: 'a',
            difficulty: 'easy',
            rationale: 'The hotspot powers the hydrothermal features.',
          },
        },
      ],
    },
  ],
};

describe('buildCourseSpine', () => {
  it('builds deterministic IDs + a difficulty-keyed quiz with JSON-string choices', () => {
    const mods = buildCourseSpine(validCourse, 'lp1', HASH, 'v1');
    expect(mods).toHaveLength(1);
    const m = mods[0];
    expect(m.id).toBe('lp1:m1');
    expect(m.contentHash).toBe(HASH);
    const l = m.lessons[0];
    expect(l.id).toBe('lp1:m1:l1');
    expect(l.moduleId).toBe('lp1:m1');
    expect(l.durationMin).toBe(15);
    const q = l.quiz[0];
    expect(q.id).toBe('lp1:m1:l1:quiz_v1:easy'); // difficulty-keyed → caps one quiz per (lesson, difficulty)
    expect(q.correctId).toBe('a');
    expect(JSON.parse(q.choices)).toHaveLength(3);
    expect(q.contentHash).toBe(HASH);
  });

  it('drops a module with no title', () => {
    expect(buildCourseSpine({ modules: [{ title: '', lessons: [{ title: 'L' }] }] }, 'lp', HASH)).toHaveLength(0);
  });

  it('drops a module whose lessons are all invalid', () => {
    expect(buildCourseSpine({ modules: [{ title: 'M', lessons: [{ title: '' }] }] }, 'lp', HASH)).toHaveLength(0);
  });

  it('keeps a lesson but drops a quiz with fewer than 2 choices', () => {
    const mods = buildCourseSpine(
      { modules: [{ title: 'M', lessons: [{ title: 'L', quiz: { stem: 'Q', choices: [{ id: 'a', label: 'x' }], correctId: 'a' } }] }] },
      'lp',
      HASH,
    );
    expect(mods[0].lessons[0].quiz).toEqual([]);
  });

  it('drops a quiz whose correctId matches no choice', () => {
    const mods = buildCourseSpine(
      {
        modules: [
          { title: 'M', lessons: [{ title: 'L', quiz: { stem: 'Q', choices: [{ id: 'a', label: 'x' }, { id: 'b', label: 'y' }], correctId: 'z' } }] },
        ],
      },
      'lp',
      HASH,
    );
    expect(mods[0].lessons[0].quiz).toEqual([]);
  });

  it('defaults an invalid difficulty to medium', () => {
    const mods = buildCourseSpine(
      {
        modules: [
          { title: 'M', lessons: [{ title: 'L', quiz: { stem: 'Q', choices: [{ id: 'a', label: 'x' }, { id: 'b', label: 'y' }], correctId: 'a', difficulty: 'impossible' } }] },
        ],
      },
      'lp',
      HASH,
    );
    expect(mods[0].lessons[0].quiz[0].difficulty).toBe('medium');
    expect(mods[0].lessons[0].quiz[0].id).toBe('lp:m1:l1:quiz_v1:medium');
  });

  it('returns [] for empty/garbage input', () => {
    expect(buildCourseSpine(null, 'lp', HASH)).toEqual([]);
    expect(buildCourseSpine({}, 'lp', HASH)).toEqual([]);
    expect(buildCourseSpine({ modules: [] }, 'lp', HASH)).toEqual([]);
  });

  it('assigns sequential ordinals/ids across multiple modules and lessons', () => {
    const course: GenCourse = {
      modules: [
        {
          title: 'Module One',
          lessons: [{ title: 'M1 Lesson A' }, { title: 'M1 Lesson B' }],
        },
        {
          title: 'Module Two',
          lessons: [{ title: 'M2 Lesson A' }],
        },
      ],
    };
    const mods = buildCourseSpine(course, 'lp', HASH, 'v1');
    expect(mods).toHaveLength(2);

    expect(mods[0].id).toBe('lp:m1');
    expect(mods[0].ordinal).toBe(1);
    expect(mods[1].id).toBe('lp:m2');
    expect(mods[1].ordinal).toBe(2);

    // Module 1: two lessons, numbering 1,2
    expect(mods[0].lessons.map((l) => l.id)).toEqual(['lp:m1:l1', 'lp:m1:l2']);
    expect(mods[0].lessons.map((l) => l.ordinal)).toEqual([1, 2]);
    expect(mods[0].lessons.every((l) => l.moduleId === 'lp:m1')).toBe(true);

    // Module 2: lesson numbering resets to 1, parented to lp:m2
    expect(mods[1].lessons.map((l) => l.id)).toEqual(['lp:m2:l1']);
    expect(mods[1].lessons.map((l) => l.ordinal)).toEqual([1]);
    expect(mods[1].lessons[0].moduleId).toBe('lp:m2');
  });

  it('drops a module with missing OR non-array lessons and a quiz with an absent correctId', () => {
    // (1) lessons omitted entirely → module has no usable lessons → dropped, no throw.
    expect(buildCourseSpine({ modules: [{ title: 'M' }] }, 'lp', HASH)).toEqual([]);
    // (1b) a genuinely NON-array lessons value (untrusted model output) is coerced to [] (Array.isArray
    // guard), so the module is dropped rather than throwing TypeError mid-batch.
    expect(buildCourseSpine({ modules: [{ title: 'M', lessons: 'oops' as never }] }, 'lp', HASH)).toEqual([]);
    expect(buildCourseSpine({ modules: [{ title: 'M', lessons: 5 as never }] }, 'lp', HASH)).toEqual([]);
    // (1c) a non-array `modules` and non-array `choices` are likewise coerced (no throw on garbage).
    expect(buildCourseSpine({ modules: 'nope' as never }, 'lp', HASH)).toEqual([]);
    expect(
      buildCourseSpine({ modules: [{ title: 'M', lessons: [{ title: 'L', quiz: { stem: 'Q', choices: 'bad' as never, correctId: 'a' } }] }] }, 'lp', HASH)[0].lessons[0].quiz,
    ).toEqual([]);

    // (2) correctId entirely absent (undefined): no choice id === undefined → quiz dropped.
    const mods = buildCourseSpine(
      {
        modules: [
          {
            title: 'M',
            lessons: [{ title: 'L', quiz: { stem: 'Q', choices: [{ id: 'a', label: 'x' }, { id: 'b', label: 'y' }] } }],
          },
        ],
      },
      'lp',
      HASH,
    );
    expect(mods[0].lessons[0].quiz).toEqual([]);
  });

  it('filters blank-label choices, dropping the quiz below 2, and trims kept labels', () => {
    // Whitespace-only label is filtered → only 1 valid choice remains → quiz dropped.
    const dropped = buildCourseSpine(
      {
        modules: [
          {
            title: 'M',
            lessons: [{ title: 'L', quiz: { stem: 'Q', choices: [{ id: 'a', label: 'x' }, { id: 'b', label: '   ' }], correctId: 'a' } }],
          },
        ],
      },
      'lp',
      HASH,
    );
    expect(dropped[0].lessons[0].quiz).toEqual([]);

    // Two good choices survive and their labels are trimmed in the stored JSON string.
    const kept = buildCourseSpine(
      {
        modules: [
          {
            title: 'M',
            lessons: [{ title: 'L', quiz: { stem: 'Q', choices: [{ id: 'a', label: '  x  ' }, { id: 'b', label: 'y' }], correctId: 'a' } }],
          },
        ],
      },
      'lp',
      HASH,
    );
    const q = kept[0].lessons[0].quiz[0];
    expect(JSON.parse(q.choices)).toEqual([
      { id: 'a', label: 'x' },
      { id: 'b', label: 'y' },
    ]);
  });

  it('coerces invalid/zero/negative/non-number durationMin to null and rounds positive floats', () => {
    const build = (durationMin: unknown) =>
      buildCourseSpine(
        { modules: [{ title: 'M', lessons: [{ title: 'L', durationMin }] }] },
        'lp',
        HASH,
      )[0].lessons[0].durationMin;

    expect(build(0)).toBeNull();
    expect(build(-5)).toBeNull();
    expect(build('15')).toBeNull(); // string is not a number → null
    expect(build(undefined)).toBeNull();
    expect(build(12.6)).toBe(13); // Math.round on a positive number
  });
});

// --- decomposeLessons orchestration: mock the DB + model, assert cost-discipline + counts ---

const DECOMPOSE_VERSION = 'v1'; // mirrors the module default (no env override in tests)

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// Replicate composeLessonSource() exactly so we can compute the model-skip genHash deterministically.
function composeSource(lp: { title?: string | null; subject?: string | null; gradeLevel?: string | null; objective?: string | null; standards?: string | null }): string {
  return [
    lp.title ?? null,
    lp.subject ? `Subject: ${lp.subject}` : null,
    lp.gradeLevel ? `Grade level: ${lp.gradeLevel}` : null,
    lp.objective ? `Objective / essential question: ${lp.objective}` : null,
    lp.standards ? `Standards: ${lp.standards}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

interface Row {
  id: string;
  title: string | null;
  subject: string | null;
  gradeLevel: string | null;
  objective: string | null;
  standards: string | null;
  priorHashes: string[];
}

function row(overrides: Partial<Row> & { id: string }): Row {
  return {
    title: 'Geology of Yellowstone',
    subject: 'Earth Science',
    gradeLevel: '6-8',
    objective: 'How does the hotspot shape the park?',
    standards: 'NGSS MS-ESS',
    priorHashes: [],
    ...overrides,
  };
}

const modelCourse: GenCourse = {
  modules: [
    {
      title: 'Hotspot & Caldera',
      summary: 'How the hotspot built the caldera.',
      lessons: [
        {
          title: 'The Yellowstone Hotspot',
          durationMin: 15,
          quiz: {
            stem: 'What drives the geysers?',
            choices: [
              { id: 'a', label: 'A mantle hotspot' },
              { id: 'b', label: 'Glaciers' },
            ],
            correctId: 'a',
            difficulty: 'easy',
            rationale: 'The hotspot powers the hydrothermal features.',
          },
        },
      ],
    },
  ],
};

describe('decomposeLessons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mWrite.mockResolvedValue([] as never);
    mGen.mockResolvedValue(modelCourse as never);
  });

  it('skips a thin plan (no objective) without calling generateJson', async () => {
    mRead.mockResolvedValue([row({ id: 'lp1', objective: null })] as never);

    const result = await decomposeLessons();

    expect(mGen).not.toHaveBeenCalled();
    expect(mWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ generated: 0, skipped: 1, failed: 0 });
  });

  it('content-hash gate skips an already-generated plan without a model call', async () => {
    const lp = row({ id: 'lp2' });
    const genHash = sha(`${lp.id}|${composeSource(lp)}|${DECOMPOSE_VERSION}`);
    mRead.mockResolvedValue([{ ...lp, priorHashes: [genHash] }] as never);

    const result = await decomposeLessons();

    expect(mGen).not.toHaveBeenCalled();
    expect(mWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ generated: 0, skipped: 1, failed: 0 });
  });

  it('counts a generation/parse error as failed and continues to the next plan', async () => {
    mRead.mockResolvedValue([row({ id: 'lp3' }), row({ id: 'lp4' })] as never);
    mGen
      .mockRejectedValueOnce(new Error('gateway parse boom') as never)
      .mockResolvedValueOnce(modelCourse as never);

    const result = await decomposeLessons();

    expect(result).toEqual({ generated: 1, skipped: 0, failed: 1 });
    expect(mGen).toHaveBeenCalledTimes(2);
    // persist() runs only for the second (successful) plan → spine + topic-grounding = 2 writes.
    expect(mWrite).toHaveBeenCalledTimes(2);
    expect(mWrite.mock.calls.every((c) => (c[1] as { lpId: string }).lpId === 'lp4')).toBe(true);
  });

  it('counts a model course that yields no usable modules as failed (not generated)', async () => {
    mRead.mockResolvedValue([row({ id: 'lp5' })] as never);
    // All modules blank-titled → buildCourseSpine returns [].
    mGen.mockResolvedValue({ modules: [{ title: '   ', lessons: [{ title: 'L' }] }] } as never);

    const result = await decomposeLessons();

    expect(result).toEqual({ generated: 0, skipped: 0, failed: 1 });
    expect(mGen).toHaveBeenCalledTimes(1);
    expect(mWrite).not.toHaveBeenCalled();
  });

  it('respects the limit batch cap and stops after N generations', async () => {
    mRead.mockResolvedValue([row({ id: 'lp6' }), row({ id: 'lp7' }), row({ id: 'lp8' })] as never);

    const result = await decomposeLessons(1);

    expect(result.generated).toBe(1);
    expect(mGen).toHaveBeenCalledTimes(1); // third plan never reaches the model
  });

  it('persists via MERGE-on-id payload and grounds quiz TESTS to existing topics', async () => {
    mRead.mockResolvedValue([row({ id: 'lp9' })] as never);

    const result = await decomposeLessons();

    expect(result).toEqual({ generated: 1, skipped: 0, failed: 0 });
    expect(mWrite).toHaveBeenCalledTimes(2);

    // First write: the spine MERGE with deterministic ids from the validated buildCourseSpine output.
    const [spineCypher, spineParams] = mWrite.mock.calls[0] as [string, { lpId: string; modules: Array<{ id: string; lessons: Array<{ id: string; quiz: Array<{ id: string }> }> }> }];
    expect(spineCypher).toContain('MERGE (mod:Module {id: m.id})');
    expect(spineParams.lpId).toBe('lp9');
    expect(spineParams.modules[0].id).toBe('lp9:m1');
    expect(spineParams.modules[0].lessons[0].id).toBe('lp9:m1:l1');
    expect(spineParams.modules[0].lessons[0].quiz[0].id).toBe('lp9:m1:l1:quiz_v1:easy');

    // Second write: the RELATES_TO_TOPIC → TESTS grounding, keyed only by lpId.
    const [topicCypher, topicParams] = mWrite.mock.calls[1] as [string, { lpId: string }];
    expect(topicCypher).toContain('MERGE (qq)-[:TESTS]->(t)');
    expect(topicParams).toEqual({ lpId: 'lp9' });
  });
});
