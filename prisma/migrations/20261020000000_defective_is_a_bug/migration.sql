-- "Defective" now means a software defect found at a step, not a broken test case.
ALTER TABLE "TestCase" DROP COLUMN "needsUpdate",
DROP COLUMN "needsUpdateNote";
