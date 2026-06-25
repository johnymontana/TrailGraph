import { describe, it, expect, vi } from 'vitest';

// Pure-logic test: stub the I/O deps so importing the module never touches a driver or the gateway.
vi.mock('../neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('../generate', () => ({ generateJson: vi.fn() }));

import { buildCourseSpine, type GenCourse } from './decompose-lessons';

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
});
