// Re-tune the Ranger Cadet badge so it reflects completing a couple of lessons rather than a single (often
// trivially easy) question — the badge felt unearned firing on the first correct answer. Idempotent MERGE-SET
// on the existing :Badge node (seeded in 021); awardEarnedBadges is additive so no already-earned badge is revoked.
MERGE (b:Badge {id:'cadet'}) SET b.criteria = 'Complete two lessons';
