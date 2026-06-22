// Vector indexes for the NPS-expansion nodes (Place/Person) so they're searchable by semantic vector
// like parks (park_embedding) and articles (article_embedding, already in 001). 1536-dim cosine to
// match EMBEDDING_DIM. Embeddings are written by lib/sync/embed-nodes.ts (content-hash gated).
CREATE VECTOR INDEX place_embedding IF NOT EXISTS FOR (n:Place) ON (n.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } };
CREATE VECTOR INDEX person_embedding IF NOT EXISTS FOR (n:Person) ON (n.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } };
