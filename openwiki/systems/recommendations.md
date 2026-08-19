---
type: recommendation system
title: Personalized recommendations and ranking
description: Constraint-safe park recommendation, novelty-aware preference ranking, node-based explanations, and authenticated live rank API behavior.
tags: [recommendations, personalization, ranking, neo4j]
---
# Personalized recommendations and ranking

`lib/recommend.ts` owns the recommendation family: `forYou`, `forYouFromNode`, `rankParks`, and `resolveRankParams`. It consumes the same canonical user graph written by [Ranger memory](ranger-memory.md), and exposes authenticated graph recommendations at `GET /api/graph/recommend`.

## Constraints before scoring

Hard travel constraints are Cypher eligibility predicates, not soft ranking: RV length must fit a campground, wheelchair need requires a wheelchair-accessible campground, and every required amenity must be present where the model permits it (campground/place/visitor-center association). A candidate cannot be promoted because it scores well if it fails these predicates. `resolveRankParams()` merges saved constraints with request controls: request scalar controls override saved values, aliases and numeric ranges are normalized/clamped, a nonpositive RV length means no RV constraint, and anonymous callers have no saved context. Facets remain active; overrides do not silently erase them.

## Candidate scoring and explanations

`forYou(userId)` reads positive-weight `PREFERS` relationships, filters parks already CONSIDERED or planned to preserve novelty, optionally uses home distance, and scores matching activities/topics. If no personalized candidate remains, it returns a popular fallback rather than an empty unexplained recommendation. `forYouFromNode()` obtains two-hop park candidates from a seed, prioritizes dimensions the user loves, retains the seed name when constraints filter all rows, and returns explanation reasons tied to shared/loved dimensions.

`rankParks()` combines facets and hard constraints with optional preference weighting; crowd tolerance uses signed scoring. Consumers should render returned reasons/provenance rather than reconstructing an explanation from labels. The product also uses `lib/explain.ts` for user-facing preference rationale.

## API and validation

The recommendation route requires a session, decodes/validates seed and request values, applies a per-user rate limit, then shapes graph output. Add a new preference dimension across its canonical bridge, eligibility/query predicate, rank input resolution, explanation output, route schema and test; otherwise saved state and request overrides drift.

Focused evidence is `lib/recommend.test.ts` for hard filters, full-text/facet alignment, cold start, scoring, aliases/clamps and override precedence; use `tests/integration/recommend.itest.ts` and `tests/integration/graph-recommend.itest.ts` for real graph/API behavior.