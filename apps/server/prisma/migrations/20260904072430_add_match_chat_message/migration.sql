-- CreateTable
CREATE TABLE "MatchChatMessage" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchChatMessage_matchId_seq_key" ON "MatchChatMessage"("matchId", "seq");

-- AddForeignKey
ALTER TABLE "MatchChatMessage" ADD CONSTRAINT "MatchChatMessage_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "GameResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
