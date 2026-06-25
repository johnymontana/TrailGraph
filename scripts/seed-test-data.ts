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
          yell.images=['https://www.nps.gov/test/yell.jpg'], yell.imagesFull='[{"url":"https://www.nps.gov/test/yell.jpg"}]',
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

  // ── NPS data-features fixtures (plan F1–F10 + bonuses) ──────────────────────────
  // Second block so it can MATCH the nodes the first block MERGEd (committed by now).
  await writeGraph(`
    MATCH (yell:Park {parkCode:'yell'}), (grca:Park {parkCode:'grca'})
    MATCH (cg:Campground {id:'cg-canyon'})
    MATCH (lot:ParkingLot {id:'lot-canyon'})
    MATCH (ev:Event {id:'event-yell-astro'})
    MATCH (ttd:ThingToDo {id:'ttd-rim'})
    MATCH (art:Article {id:'article-yell-geysers'})
    MATCH (amrest:Amenity {id:'amen-restrooms'})
    MATCH (volc:Topic {id:'top-volc'})
    // F1: real operatingHours JSON (Park Hours all-day + a dated road closure) + derived season summary.
    SET yell.operatingHours='[{"name":"Park Hours","standardHours":{"monday":"All Day","tuesday":"All Day","wednesday":"All Day","thursday":"All Day","friday":"All Day","saturday":"All Day","sunday":"All Day"},"exceptions":[]},{"name":"North Entrance Road","standardHours":{"monday":"All Day","tuesday":"All Day","wednesday":"All Day","thursday":"All Day","friday":"All Day","saturday":"All Day","sunday":"All Day"},"exceptions":[{"name":"Winter closure","startDate":"2026-11-01","endDate":"2027-04-15","exceptionHours":{"monday":"Closed","tuesday":"Closed","wednesday":"Closed","thursday":"Closed","friday":"Closed","saturday":"Closed","sunday":"Closed"}}]}]',
        yell.seasonalClosureSummary='North Entrance Road: closed Nov 1 – Apr 15'
    MERGE (winter:Season {name:'winter'}) MERGE (spring:Season {name:'spring'})
    MERGE (summer:Season {name:'summer'}) MERGE (fall:Season {name:'fall'})
    MERGE (yell)-[:OPEN_IN]->(summer) MERGE (yell)-[:OPEN_IN]->(fall)
    MERGE (yell)-[:OPEN_IN]->(spring) MERGE (yell)-[:OPEN_IN]->(winter)
    // F1 hours nodes (so graph-level reads have data too).
    MERGE (oh:OperatingHours {id:'yell:hours:1'})
      SET oh.name='North Entrance Road', oh.allYear=false, oh.mon='All Day', oh.tue='All Day', oh.wed='All Day', oh.thu='All Day', oh.fri='All Day', oh.sat='All Day', oh.sun='All Day'
    MERGE (yell)-[:HAS_HOURS]->(oh)
    MERGE (ex:HoursException {id:'yell:hours:1:exc:0'})
      SET ex.name='Winter closure', ex.startDate=date('2026-11-01'), ex.endDate=date('2027-04-15'),
          ex.mon='Closed', ex.tue='Closed', ex.wed='Closed', ex.thu='Closed', ex.fri='Closed', ex.sat='Closed', ex.sun='Closed'
    MERGE (oh)-[:HAS_EXCEPTION]->(ex)
    // F2: structured entrance fee + a fee-free day; grca charges nothing.
    MERGE (fee:EntranceFee {id:'yell:Private Vehicle'}) SET fee.title='Entrance - Private Vehicle', fee.cost=35.0, fee.unit='vehicle'
    MERGE (yell)-[:CHARGES]->(fee)
    SET grca.feeFree=true
    MERGE (ff:FeeFreeDay {date: date('2026-08-04')}) SET ff.name='Anniversary of the Great American Outdoors Act'
    // F3: campground inventory + the (previously dead) (:Campground)-[:HAS_AMENITY] edge.
    SET cg.totalSites=273, cg.sitesReservable=273, cg.sitesFirstCome=0, cg.tentSites=200, cg.rvSites=73,
        cg.electricSites=0, cg.groupSites=0, cg.hasDumpStation=true, cg.hasShowers=true,
        cg.hasPotableWater=true, cg.hasHookups=false, cg.cellReception=true
    MERGE (dump:Amenity {id:'amen:dump-station'}) SET dump.name='Dump Station'
    MERGE (cg)-[:HAS_AMENITY]->(dump)
    // F4: event enrichment + EventType + materialized CalendarDate.
    SET ev.category='Astronomy', ev.isFree=true, ev.regRequired=false
    MERGE (etype:EventType {name:'Astronomy'}) MERGE (ev)-[:OF_TYPE]->(etype)
    MERGE (cd:CalendarDate {date: date('2026-08-12')}) MERGE (ev)-[:OCCURS_ON]->(cd)
    // F5: tag accessibility amenities + a canonical wheelchair amenity on the campground.
    SET amrest.accessibility=true
    MERGE (wc:Amenity {id:'amen:wheelchair-accessible'}) SET wc.name='Wheelchair Accessible', wc.accessibility=true
    MERGE (cg)-[:HAS_AMENITY]->(wc)
    // F7: thing-to-do facets + topic/season edges.
    SET ttd.petsAllowed=true, ttd.timeOfDay=['Dawn','Dusk'], ttd.season=['spring','summer','fall'],
        ttd.durationText='1-2 hours', ttd.reservationRequired=false, ttd.feesApply=false
    MERGE (ttd)-[:RELATES_TO_TOPIC]->(volc)
    MERGE (ttd)-[:BEST_IN]->(summer)
    // F8: news release + article body (activates article_fulltext).
    MERGE (nr:NewsRelease {id:'news-yell-1'})
      SET nr.title='Yellowstone announces summer road work', nr.abstract='Crews will repave the Grand Loop Road this summer.',
          nr.url='https://www.nps.gov/yell/news1.htm', nr.releaseDate=date('2026-06-15')
    MERGE (nr)-[:ABOUT]->(yell)
    SET art.body='The Yellowstone caldera powers more than 10,000 hydrothermal features, including the largest concentration of geysers on Earth such as Old Faithful and Steamboat Geyser.'
    // F10: parking detail (accessible spaces + EV charging).
    SET lot.accessibleSpaces=12, lot.hasEvCharging=true, lot.hasLiveData=false
    // Bonus: queryable contacts + a lesson plan (Ranger School courseware).
    SET yell.phone='307-344-7381', yell.email='yell_info@nps.gov'
    MERGE (lp:LessonPlan {id:'lesson-yell-geology'})
      SET lp.title='Geology of Yellowstone', lp.url='https://www.nps.gov/yell/lesson1.htm',
          lp.gradeLevel='6-8', lp.gradeMin=6, lp.gradeMax=8, lp.subject='Earth Science',
          lp.objective='Explain how the Yellowstone hotspot drives the park''s geysers and calderas.',
          lp.standards='CCSS.ELA-LITERACY.RST.6-8.4', lp.image='https://www.nps.gov/common/uploads/lesson-geology.jpg',
          lp.durationMin=50
    MERGE (lp)-[:ABOUT]->(yell)
    MERGE (volc2:Topic {id:'top-volc'}) MERGE (lp)-[:RELATES_TO_TOPIC]->(volc2)
    // Ranger School: grade-band vocab node (parseGradeBand → TARGETS), the courseware spine
    // (Module → Lesson → QuizQuestion), and a park-grounded media join (CAN_USE_MEDIA).
    MERGE (gb:GradeBand {id:'6-8'}) SET gb.min=6, gb.max=8, gb.label='Grades 6–8'
    MERGE (lp)-[:TARGETS]->(gb)
    MERGE (mod:Module {id:'lesson-yell-geology:m1'})
      SET mod.lessonPlanId='lesson-yell-geology', mod.ordinal=1, mod.title='Hotspot & Caldera',
          mod.summary='How the Yellowstone hotspot built the caldera and powers its geysers.'
    MERGE (lp)-[:CONTAINS_MODULE]->(mod)
    MERGE (les:Lesson {id:'lesson-yell-geology:m1:l1'})
      SET les.moduleId='lesson-yell-geology:m1', les.ordinal=1, les.title='The Yellowstone Hotspot', les.durationMin=15
    MERGE (mod)-[:CONTAINS_LESSON]->(les)
    MERGE (q:QuizQuestion {id:'lesson-yell-geology:m1:l1:quiz_v1:easy'})
      SET q.lessonId='lesson-yell-geology:m1:l1', q.ordinal=1,
          q.stem='What drives Yellowstone''s geysers and calderas?',
          q.choices='[{"id":"hotspot","label":"A stationary mantle hotspot"},{"id":"glacier","label":"Retreating glaciers"},{"id":"meteor","label":"A meteor impact"}]',
          q.correctId='hotspot',
          q.rationale='The Yellowstone hotspot is a plume of hot mantle that powers the park''s hydrothermal features.',
          q.difficulty='easy', q.topic='Volcanoes'
    MERGE (les)-[:HAS_QUESTION]->(q)
    MERGE (q)-[:TESTS]->(volc2)
    MERGE (af:AudioFile {id:'audio-yell-oldfaithful'})
      SET af.title='Old Faithful Audio Tour', af.durationMs=180000,
          af.url='https://www.nps.gov/yell/oldfaithful-audio.htm',
          af.transcript='Old Faithful erupts every 60 to 90 minutes, sending boiling water up to 180 feet into the air.'
    MERGE (af)-[:ABOUT]->(yell)
    MERGE (lp)-[:CAN_USE_MEDIA]->(af)
    // Phase 5: a seeded certificate for the /learn/cert/<slug> share page (fixed slug for E2E determinism).
    MERGE (certuser:User {userId:'e2e-cert-user'})
    MERGE (cert:Certificate {userId:'e2e-cert-user', lessonPlanId:'lesson-yell-geology'})
      ON CREATE SET cert.id='cert:e2e-cert-user:lesson-yell-geology', cert.shareSlug='test0123456789abcd',
                    cert.score=0.95, cert.issuedAt=datetime('2026-06-20T00:00:00Z')
    MERGE (certuser)-[:ISSUED]->(cert)
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
