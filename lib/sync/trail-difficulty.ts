/**
 * Trail difficulty + estimated hiking time (ADR-069). NPS provides no standardized difficulty, so we
 * DERIVE structured, sortable estimates from objective inputs — and label them estimates, never a safety
 * guarantee (the UI keeps the NPS-safety disclaimer + a `dataConfidence` badge). Pure (unit-tested); the
 * graph-writing derive step calls these over the aggregated `:Trail` metrics.
 *
 *  - difficultyRating: the Shenandoah numeric rating  r = sqrt(2 · gainFt · lengthMi)
 *  - difficulty:       easy | moderate | strenuous, banded from the rating + nudged by trailClass/sacScale
 *  - estTimeHrs:       Naismith's rule  (lengthMi / 3) + (gainFt / 2000)  + a gentle steep-descent term
 */
export type Difficulty = 'easy' | 'moderate' | 'strenuous';

/** Shenandoah-style numeric difficulty rating. Pure. Higher = harder; 0 for flat/empty input. */
export function shenandoahRating(lengthMiles: number, elevationGainFt: number): number {
  const len = Math.max(0, lengthMiles || 0);
  const gain = Math.max(0, elevationGainFt || 0);
  return Math.round(Math.sqrt(2 * gain * len) * 10) / 10;
}

/**
 * Band a rating into easy|moderate|strenuous (Shenandoah cutoffs: <50 / 50–100 / >100; upper bands
 * collapsed). A technical trail (sac_scale ≥ 4, or a primitive trailClass ≤ 1) bumps difficulty up one
 * step. Pure.
 */
export function difficultyBand(
  rating: number,
  opts: { trailClass?: number | null; sacScale?: number | null } = {},
): Difficulty {
  let band: Difficulty = rating < 50 ? 'easy' : rating < 100 ? 'moderate' : 'strenuous';
  const technical =
    (opts.sacScale != null && opts.sacScale >= 4) || (opts.trailClass != null && opts.trailClass <= 1);
  if (technical && band === 'easy') band = 'moderate';
  else if (technical && band === 'moderate') band = 'strenuous';
  return band;
}

/** Estimated hiking time via Naismith's rule (+ a gentle steep-descent term). Pure. Returns hours. */
export function naismithHours(
  lengthMiles: number,
  elevationGainFt: number,
  elevationLossFt = 0,
): number {
  const len = Math.max(0, lengthMiles || 0);
  const gain = Math.max(0, elevationGainFt || 0);
  const loss = Math.max(0, elevationLossFt || 0);
  // Naismith: 1 hr / 3 mi + 1 hr / 2000 ft ascent. A net-descent hike still takes time → a small term.
  const base = len / 3 + gain / 2000;
  const descent = loss > gain ? (loss - gain) / 4000 : 0;
  return Math.round((base + descent) * 10) / 10;
}

export interface TrailGrade {
  difficultyRating: number;
  difficulty: Difficulty;
  estTimeHrs: number;
}

/** Combined grade for a trail's derived metrics. Pure. */
export function gradeTrail(input: {
  lengthMiles: number;
  elevationGainFt: number;
  elevationLossFt?: number;
  trailClass?: number | null;
  sacScale?: number | null;
}): TrailGrade {
  const difficultyRating = shenandoahRating(input.lengthMiles, input.elevationGainFt);
  return {
    difficultyRating,
    difficulty: difficultyBand(difficultyRating, {
      trailClass: input.trailClass,
      sacScale: input.sacScale,
    }),
    estTimeHrs: naismithHours(input.lengthMiles, input.elevationGainFt, input.elevationLossFt ?? 0),
  };
}
