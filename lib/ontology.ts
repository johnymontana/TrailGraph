import type { OntologyDocument } from '@neo4j-labs/agent-memory';

/**
 * TrailGraph custom NAMS ontology (ADR-011): POLE+O specialized for travel/parks so extraction
 * yields useful, typed entities and reduces noise. Relationships are an allowlist (RELATED_TO is
 * NAMS's built-in fallback). PII (exact home address) flagged so NAMS transforms it at write.
 *
 * `category` uses PropertyDef.enum — partly addressing the "constrain extracted values" gap (N3),
 * though value→domain-vocabulary canonicalization still happens app-side (lib/canonicalize.ts).
 */
export const trailgraphOntology: OntologyDocument = {
  domain: {
    id: 'trailgraph',
    name: 'TrailGraph Travel & Parks',
    description: 'Traveler preferences, trips, and interests for U.S. National Park planning.',
    emoji: '🏞️',
  },
  entityTypes: [
    {
      label: 'Traveler',
      poleType: 'Person',
      properties: [
        { name: 'name', type: 'string' },
        // Exact home address is PII → flagged for hash/redact at write (§11.5, §14).
        { name: 'homeAddress', type: 'string' },
      ],
    },
    {
      label: 'Preference',
      poleType: 'Object',
      properties: [
        { name: 'value', type: 'string', required: true },
        {
          name: 'category',
          type: 'string',
          enum: ['activity', 'topic', 'terrain', 'vibe', 'crowd', 'season', 'accessibility', 'budget'],
        },
      ],
    },
    {
      label: 'Interest',
      poleType: 'Object',
      properties: [{ name: 'value', type: 'string', required: true }],
    },
    {
      label: 'Constraint',
      poleType: 'Object',
      properties: [
        { name: 'kind', type: 'string', enum: ['accessibility', 'budget', 'dates', 'partySize'] },
        { name: 'value', type: 'string' },
      ],
    },
    {
      label: 'ParkLocation',
      poleType: 'Location',
      properties: [{ name: 'name', type: 'string', required: true }],
    },
    {
      label: 'Trip',
      poleType: 'Event',
      properties: [
        { name: 'name', type: 'string' },
        { name: 'startDate', type: 'string' },
        { name: 'endDate', type: 'string' },
      ],
    },
  ],
  relationships: [
    { type: 'HAS_PREFERENCE', source: 'Traveler', target: 'Preference' },
    { type: 'INTERESTED_IN', source: 'Traveler', target: 'Interest' },
    { type: 'WANTS_TO_VISIT', source: 'Traveler', target: 'ParkLocation' },
    { type: 'AVOIDS', source: 'Traveler', target: 'Interest' },
    { type: 'HAS_CONSTRAINT', source: 'Traveler', target: 'Constraint' },
    { type: 'PLANNED', source: 'Traveler', target: 'Trip' },
    { type: 'TRAVELS_WITH', source: 'Traveler', target: 'Traveler' },
  ],
};

/** PII fields to flag (consumed by setup script / future ontology PII config). */
export const PII_FIELDS = [{ entity: 'Traveler', field: 'homeAddress', transform: 'hash' }];
