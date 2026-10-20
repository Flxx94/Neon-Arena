-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ip" TEXT;

-- CreateIndex
CREATE INDEX "User_ip_idx" ON "User"("ip");
