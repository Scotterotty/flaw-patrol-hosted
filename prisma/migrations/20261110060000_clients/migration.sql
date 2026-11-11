-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "clients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "clients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "clients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "RunEntry" ADD COLUMN     "clients" TEXT[] DEFAULT ARRAY[]::TEXT[];
