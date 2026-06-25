// Ranger School courseware (docs/RANGER_SCHOOL_DESIGN.md): the lesson-plan spine
// (:LessonPlan)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(:Lesson)-[:HAS_QUESTION]->(:QuizQuestion),
// cached AI content (:LessonContent), gamification (:Badge/:Certificate), grade-band vocab (:GradeBand),
// cross-park (:LearningTrail), and classroom (:Cohort). New relationship types (CONTAINS_MODULE,
// CONTAINS_LESSON, HAS_QUESTION, HAS_CONTENT, TESTS, CAN_USE_MEDIA, TARGETS, GRANTS, FOR_TOPIC, plus the
// per-user ENROLLED_IN/COMPLETED/ANSWERED/STRUGGLES_WITH/MASTERY/EARNED/ISSUED bridges) need no DDL — they
// materialize when data creates them. Idempotent; runner splits on ';' and filters '//' lines.

// --- Node-key uniqueness (deterministic sha256/natural ids; see design §2) ---
CREATE CONSTRAINT module_id IF NOT EXISTS FOR (m:Module) REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT lesson_id IF NOT EXISTS FOR (l:Lesson) REQUIRE l.id IS UNIQUE;
CREATE CONSTRAINT quizquestion_id IF NOT EXISTS FOR (q:QuizQuestion) REQUIRE q.id IS UNIQUE;
CREATE CONSTRAINT lessoncontent_id IF NOT EXISTS FOR (c:LessonContent) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT badge_id IF NOT EXISTS FOR (b:Badge) REQUIRE b.id IS UNIQUE;
CREATE CONSTRAINT certificate_id IF NOT EXISTS FOR (c:Certificate) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT gradeband_id IF NOT EXISTS FOR (g:GradeBand) REQUIRE g.id IS UNIQUE;
CREATE CONSTRAINT learningtrail_id IF NOT EXISTS FOR (t:LearningTrail) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT cohort_id IF NOT EXISTS FOR (co:Cohort) REQUIRE co.id IS UNIQUE;

// --- Lookup/range indexes for adaptive quiz selection + certificate/cohort sharing ---
CREATE INDEX quizquestion_lesson IF NOT EXISTS FOR (q:QuizQuestion) ON (q.lessonId);
CREATE INDEX quizquestion_difficulty IF NOT EXISTS FOR (q:QuizQuestion) ON (q.difficulty);
CREATE INDEX lesson_module IF NOT EXISTS FOR (l:Lesson) ON (l.moduleId);
CREATE INDEX certificate_shareslug IF NOT EXISTS FOR (c:Certificate) ON (c.shareSlug);
CREATE INDEX cohort_joincode IF NOT EXISTS FOR (co:Cohort) ON (co.joinCode);

// --- Full-text for lesson/quiz reuse + tutor grounding ---
CREATE FULLTEXT INDEX lesson_fulltext IF NOT EXISTS FOR (l:Lesson) ON EACH [l.title];
CREATE FULLTEXT INDEX quizquestion_fulltext IF NOT EXISTS FOR (q:QuizQuestion) ON EACH [q.stem];

// --- Static Junior Ranger badge taxonomy (idempotent MERGE; criteria checked by the grading tool).
// Topic-specialist badges (geologist/historian) are seeded without FOR_TOPIC edges here — those are
// curated/derived later against real :Topic ids so we never mint a duplicate name-keyed Topic (design §11). ---
MERGE (b:Badge {id:'explorer'})      SET b.tier='bronze', b.label='Explorer',       b.icon='LuCompass',       b.criteria='Enroll in your first course';
MERGE (b:Badge {id:'cadet'})         SET b.tier='bronze', b.label='Ranger Cadet',    b.icon='LuBookOpen',      b.criteria='Complete your first lesson';
MERGE (b:Badge {id:'ranger'})        SET b.tier='silver', b.label='Junior Ranger',   b.icon='LuAward',         b.criteria='Complete a course with quiz score >= 80%';
MERGE (b:Badge {id:'senior-ranger'}) SET b.tier='gold',   b.label='Senior Ranger',   b.icon='LuMedal',         b.criteria='Complete three courses';
MERGE (b:Badge {id:'geologist'})     SET b.tier='topic',  b.label='Junior Geologist',b.icon='LuMountain',      b.criteria='Master the Geology/Volcanoes topic';
MERGE (b:Badge {id:'historian'})     SET b.tier='topic',  b.label='Junior Historian',b.icon='LuLandmark',      b.criteria='Master a History topic';
