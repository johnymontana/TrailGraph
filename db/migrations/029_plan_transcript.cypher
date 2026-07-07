// Per-user /plan ranger-chat transcript replay (ADR-076 P3.9), the sibling of the lesson TutorTranscript:
// persist the client's authoritative Eve event stream per user so a reload / pull-to-refresh on the plan
// surface rehydrates the chat — WITH its cards — instead of emptying it. One node per user; the app keys
// it by userId (a single ranger conversation per user), so the constraint is on PlanTranscript.userId.
CREATE CONSTRAINT plantranscript_userid IF NOT EXISTS FOR (t:PlanTranscript) REQUIRE t.userId IS UNIQUE;
