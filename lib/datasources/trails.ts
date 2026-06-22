import { readGraph, writeGraph } from '../neo4j';

/**
 * Trail difficulty (§5c). Rather than depend on an external trails API, we *derive* a structured
 * `difficulty` for existing `:ThingToDo` nodes from their own title/description text (which often
 * states "easy"/"strenuous"). This backs the 🟢/🟡/🔴 dots with a real field. An OSM/Overpass adapter
 * can later enrich length/elevation behind this same module.
 */
export type Difficulty = 'easy' | 'moderate' | 'strenuous';

const EASY = /\b(easy|accessible|paved|stroller|wheelchair|leisurely|gentle|flat|boardwalk)\b/i;
const HARD = /\b(strenuous|difficult|challenging|steep|backcountry|scramble|technical|advanced|expert|grueling)\b/i;
const MODERATE = /\b(moderate|intermediate)\b/i;

/** Classify difficulty from free text. Pure (unit-tested). Returns null when there's no signal. */
export function classifyDifficulty(text: string): Difficulty | null {
  if (!text) return null;
  if (HARD.test(text)) return 'strenuous';
  if (MODERATE.test(text)) return 'moderate';
  if (EASY.test(text)) return 'easy';
  return null;
}

/** A colored dot for a difficulty (UI). Pure. */
export function difficultyDot(d: Difficulty | null | undefined): string {
  return d === 'easy' ? '🟢' : d === 'moderate' ? '🟡' : d === 'strenuous' ? '🔴' : '⚪';
}

/** Scan ThingToDo text and persist a derived `difficulty`. Returns the count classified. */
export async function applyTrailDifficulty(): Promise<number> {
  const rows = await readGraph<{ id: string; text: string }>(
    `MATCH (n:ThingToDo)
     RETURN n.id AS id, coalesce(n.title,'') + ' ' + coalesce(n.shortDescription,'') AS text`,
  );
  let applied = 0;
  for (const r of rows) {
    const d = classifyDifficulty(r.text);
    if (!d) continue;
    await writeGraph(`MATCH (n:ThingToDo {id:$id}) SET n.difficulty = $d`, { id: r.id, d });
    applied++;
  }
  return applied;
}
