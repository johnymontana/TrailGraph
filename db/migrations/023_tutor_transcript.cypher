// Full-fidelity per-lesson tutor transcript replay: persist the client's authoritative Eve event stream +
// session cursor per (user, lesson) so the lesson player can rehydrate the chat — WITH its interactive quiz
// and feedback cards — on reload (NAMS only holds simplified text, so this is a separate UI-replay store).
// One node per (userId, lessonId); the app keys it id = "<userId>::<lessonId>".
CREATE CONSTRAINT tutortranscript_id IF NOT EXISTS FOR (t:TutorTranscript) REQUIRE t.id IS UNIQUE;
