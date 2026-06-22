// §5 data-source props: dark-sky, crowd/visitation, trail difficulty. Indexes for Explore facets.
CREATE INDEX park_bortle IF NOT EXISTS FOR (p:Park) ON (p.bortleScale);
CREATE INDEX park_darksky IF NOT EXISTS FOR (p:Park) ON (p.darkSkyCertified);
CREATE INDEX park_crowd IF NOT EXISTS FOR (p:Park) ON (p.crowdLevel);
CREATE INDEX ttd_difficulty IF NOT EXISTS FOR (n:ThingToDo) ON (n.difficulty);
