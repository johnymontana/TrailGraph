import '../lib/load-env';
import { writeGraph, closeDriver } from '../lib/neo4j';

/**
 * Idempotent test fixtures (used by integration + e2e). A handful of real parkCodes with locations,
 * activities, topics, a campground, and one active Closure alert — enough to exercise search,
 * proximity, detail, trips, alerts, and recommendations without a full NPS sync.
 */
export async function seedTestData(): Promise<void> {
  await writeGraph(`
    // States
    MERGE (mt:State {code:'MT'}) SET mt.name='Montana'
    MERGE (wy:State {code:'WY'}) SET wy.name='Wyoming'
    MERGE (az:State {code:'AZ'}) SET az.name='Arizona'
    // Activities / topics
    MERGE (astro:Activity {id:'act-astro'}) SET astro.name='Astronomy'
    MERGE (hike:Activity {id:'act-hike'}) SET hike.name='Hiking'
    MERGE (lakes:Topic {id:'top-lakes'}) SET lakes.name='Lakes'
    MERGE (volc:Topic {id:'top-volc'}) SET volc.name='Volcanoes'
    // Parks
    MERGE (yell:Park {parkCode:'yell'})
      SET yell.name='Yellowstone', yell.fullName='Yellowstone National Park',
          yell.designation='National Park', yell.description='Geysers, wildlife, and the Yellowstone caldera.',
          yell.states='WY,MT,ID', yell.url='https://www.nps.gov/yell', yell.feeFree=false,
          yell.images=['https://example.test/yell.jpg'], yell.imagesFull='[{"url":"https://example.test/yell.jpg"}]',
          yell.entranceFees='[{"cost":"35.00","title":"Private Vehicle","description":"7 days"}]',
          yell.operatingHours='[]', yell.contacts='{}',
          yell.location=point({latitude:44.6, longitude:-110.5})
    MERGE (grca:Park {parkCode:'grca'})
      SET grca.name='Grand Canyon', grca.fullName='Grand Canyon National Park',
          grca.designation='National Park', grca.description='A mile-deep canyon with dark night skies.',
          grca.states='AZ', grca.url='https://www.nps.gov/grca', grca.feeFree=false,
          grca.images=[], grca.imagesFull='[]', grca.entranceFees='[]', grca.operatingHours='[]', grca.contacts='{}',
          grca.location=point({latitude:36.1, longitude:-112.1})
    MERGE (glac:Park {parkCode:'glac'})
      SET glac.name='Glacier', glac.fullName='Glacier National Park',
          glac.designation='National Park', glac.description='Alpine lakes and the Going-to-the-Sun Road.',
          glac.states='MT', glac.url='https://www.nps.gov/glac', glac.feeFree=false,
          glac.images=[], glac.imagesFull='[]', glac.entranceFees='[]', glac.operatingHours='[]', glac.contacts='{}',
          glac.location=point({latitude:48.7, longitude:-113.8})
    // Relationships
    MERGE (yell)-[:LOCATED_IN]->(wy) MERGE (yell)-[:LOCATED_IN]->(mt)
    MERGE (grca)-[:LOCATED_IN]->(az) MERGE (glac)-[:LOCATED_IN]->(mt)
    MERGE (yell)-[:OFFERS]->(hike) MERGE (yell)-[:HAS_TOPIC]->(volc)
    MERGE (grca)-[:OFFERS]->(astro) MERGE (grca)-[:OFFERS]->(hike)
    MERGE (glac)-[:OFFERS]->(astro) MERGE (glac)-[:OFFERS]->(hike) MERGE (glac)-[:HAS_TOPIC]->(lakes)
    // Campground in Yellowstone
    MERGE (cg:Campground {id:'cg-canyon'})
      SET cg.name='Canyon Campground', cg.location=point({latitude:44.73, longitude:-110.49}),
          cg.reservationUrl='https://www.recreation.gov/camping/campgrounds/232449'
    MERGE (cg)-[:IN_PARK]->(yell)
    // Visitor center + thing-to-do (map layer fixtures)
    MERGE (vc:VisitorCenter {id:'vc-canyon'})
      SET vc.name='Canyon Visitor Education Center', vc.location=point({latitude:44.73, longitude:-110.48})
    MERGE (vc)-[:IN_PARK]->(yell)
    MERGE (ttd:ThingToDo {id:'ttd-rim'})
      SET ttd.title='Hike the South Rim', ttd.shortDescription='Easy rim walk',
          ttd.location=point({latitude:36.06, longitude:-112.14})
    MERGE (ttd)-[:AT_PARK]->(grca)
    MERGE (ttd)-[:INVOLVES]->(hike)
    // §5 data-source props (dark-sky / crowds / difficulty) so the conditions UI + facets have fixtures.
    SET grca.darkSkyCertified=true, grca.bortleScale=2,
        glac.darkSkyCertified=true, glac.bortleScale=2, glac.crowdLevel='high', glac.bestMonths=[5,9],
        glac.monthlyVisits=[12000,14000,22000,60000,210000,520000,720000,690000,380000,120000,25000,14000],
        glac.timedEntry=true, glac.permitUrl='https://www.recreation.gov/timed-entry',
        yell.crowdLevel='very high', yell.bestMonths=[4,10],
        ttd.difficulty='easy', ttd.lengthMiles=1.5, ttd.elevationGainFt=200
    // Active Closure alert on Yellowstone mentioning the campground (two-tier alert test)
    MERGE (al:Alert {id:'alert-test-1'})
      SET al.title='Road closure near Canyon Campground', al.category='Closure', al.active=true,
          al.description='A road near Canyon Campground is closed due to weather.',
          al.url='https://www.nps.gov/yell/alert1'
    MERGE (al)-[:AFFECTS]->(yell)
  `);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedTestData()
    .then(() => {
      console.log('✓ seeded test data');
      return closeDriver();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
