import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Regression guard for the memory-forming crash (test report §3.1): Motion springs support EXACTLY two
 * keyframes, so a 3+-keyframe `scale: [...]` array under a spring transition throws at runtime
 * ("Only two keyframes currently supported with spring"). The codebase convention is to let the spring's
 * damping create the overshoot from two keyframes. This static check flags any `scale` keyframe array
 * with 3+ entries in a `motion/react` component before it can regress. A legitimately-tweened
 * multi-keyframe scale should use a non-`scale` property or be refactored rather than silence this.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.tsx') || p.endsWith('.ts') ? [p] : [];
  });
}

describe('motion spring-keyframe guard (regression for §3.1)', () => {
  it('no motion component uses a 3+-keyframe scale array (would throw under a spring)', () => {
    const root = fileURLToPath(new URL('../../components', import.meta.url));
    const offenders: string[] = [];
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('motion/react')) continue;
      const hits = src.match(/scale:\s*\[[^\]]*,[^\]]*,[^\]]*\]/g);
      if (hits) offenders.push(`${f.replace(root, 'components')}: ${hits.join(', ')}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
