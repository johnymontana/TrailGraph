// Drop the redundant :Webcam graph node (replaced by the runtime conditions path in lib/conditions.ts).
// Cleans DBs that already applied 019's webcam_id constraint. Idempotent. Runner splits on ';'.

DROP CONSTRAINT webcam_id IF EXISTS;
MATCH (w:Webcam) DETACH DELETE w;
