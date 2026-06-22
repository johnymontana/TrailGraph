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
    // Accessibility fixtures (NPS-expansion P0 #1): normalized campground accessibility props +
    // shared Amenity nodes so REQUIRES/TRAVELS_WITH filters + explain() have something to match.
    SET cg.wheelchairAccessible=true, cg.rvMaxLengthFt=40, cg.adaInfo='Accessible restrooms and paved sites.'
    MERGE (cg2:Campground {id:'cg-fishing-bridge'})
      SET cg2.name='Fishing Bridge RV Park', cg2.location=point({latitude:44.56, longitude:-110.37}),
          cg2.wheelchairAccessible=false, cg2.rvMaxLengthFt=null
    MERGE (cg2)-[:IN_PARK]->(yell)
    MERGE (am:Amenity {id:'amen-restrooms'}) SET am.name='Accessible Restrooms'
    MERGE (amwater:Amenity {id:'amen-water'}) SET amwater.name='Potable Water'
    MERGE (cg)-[:HAS_AMENITY]->(am)
    MERGE (vc)-[:HAS_AMENITY]->(am)
    MERGE (vc)-[:HAS_AMENITY]->(amwater)
    // Place fixture (HAS_PLACE) with an amenity + passport-stamp flag
    MERGE (pl:Place {id:'place-artist-point'})
      SET pl.title='Artist Point', pl.bodyText='Iconic view of the Lower Falls.',
          pl.location=point({latitude:44.72, longitude:-110.48}), pl.isStamp=true,
          pl.audioDescription='An audio description of the Lower Falls overlook.'
    MERGE (yell)-[:HAS_PLACE]->(pl)
    MERGE (pl)-[:HAS_AMENITY]->(am)
    // Person fixture spanning two parks → a thematic trail (ASSOCIATED_WITH + RELATES_TO_TOPIC)
    MERGE (per:Person {id:'person-ferdinand-hayden'})
      SET per.title='Ferdinand Hayden', per.firstName='Ferdinand', per.lastName='Hayden',
          per.tags=['Volcanoes'], per.listingDescription='Geologist whose survey helped establish Yellowstone.'
    MERGE (per)-[:ASSOCIATED_WITH]->(yell)
    MERGE (per)-[:ASSOCIATED_WITH]->(glac)
    MERGE (per)-[:RELATES_TO_TOPIC]->(volc)
    // Tour fixture (P1 #3): ordered stops referencing the Place + Visitor Center above.
    MERGE (tour:Tour {id:'tour-canyon-rim'})
      SET tour.title='Canyon Rim Tour', tour.description='A short loop along the Grand Canyon of the Yellowstone.'
    MERGE (tour)-[:IN_PARK]->(yell)
    MERGE (tstop1:TourStop {id:'tour-canyon-rim-0'}) SET tstop1.ordinal=0, tstop1.title='Artist Point', tstop1.assetType='Place'
    MERGE (tstop2:TourStop {id:'tour-canyon-rim-1'}) SET tstop2.ordinal=1, tstop2.title='Canyon Visitor Center', tstop2.assetType='VisitorCenter'
    MERGE (tour)-[:HAS_STOP]->(tstop1) MERGE (tstop1)-[:AT]->(pl)
    MERGE (tour)-[:HAS_STOP]->(tstop2) MERGE (tstop2)-[:AT]->(vc)
    // Passport stamp fixture (P2 #8): IN_PARK so "stamps at this park" + collection works.
    MERGE (stamp:PassportStamp {id:'stamp-yell-canyon'}) SET stamp.label='Canyon Village'
    MERGE (stamp)-[:IN_PARK]->(yell)
    // Entrance passes (P2 #9): national AtB pass + a yell park pass for the cost model.
    MERGE (atb:EntrancePass {id:'atb-annual'}) SET atb.name='America the Beautiful – Annual Pass', atb.cost=80.0, atb.scope='national'
    MERGE (yellpass:EntrancePass {id:'yell:Annual Pass'}) SET yellpass.name='Annual Pass', yellpass.cost=70.0, yellpass.scope='park'
    MERGE (yell)-[:OFFERS_PASS]->(yellpass)
    // Article fixture (P3): ABOUT a park for the "Learn more" section.
    MERGE (art:Article {id:'article-yell-geysers'})
      SET art.title='Geysers of Yellowstone', art.url='https://www.nps.gov/yell/geysers.htm',
          art.description='How the Yellowstone caldera powers the largest geyser field on Earth.'
    MERGE (art)-[:ABOUT]->(yell)
    // Parking lot fixture (P3): IN_PARK + accessibility flag.
    MERGE (lot:ParkingLot {id:'lot-canyon'})
      SET lot.name='Canyon Village Lot', lot.wheelchairAccessible=true,
          lot.location=point({latitude:44.73, longitude:-110.49})
    MERGE (lot)-[:IN_PARK]->(yell)
    // Event fixture (P2 #7): HELD_AT with dates for the season-aware section.
    MERGE (ev:Event {id:'event-yell-astro'})
      SET ev.title='Perseid Star Party', ev.active=true, ev.dateStart='2026-08-11', ev.dateEnd='2026-08-13'
    MERGE (ev)-[:HELD_AT]->(yell)
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
