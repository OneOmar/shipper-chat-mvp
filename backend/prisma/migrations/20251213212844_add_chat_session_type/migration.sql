-- CreateEnum
CREATE TYPE "ChatSessionType" AS ENUM ('direct', 'ai');

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "type" "ChatSessionType" NOT NULL DEFAULT 'direct';
