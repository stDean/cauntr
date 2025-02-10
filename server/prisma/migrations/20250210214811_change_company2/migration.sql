/*
  Warnings:

  - Made the column `subscriptionId` on table `company` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `Company` DROP FOREIGN KEY `Company_subscriptionId_fkey`;

-- AlterTable
ALTER TABLE `Company` MODIFY `subscriptionId` VARCHAR(191) NOT NULL;

-- AddForeignKey
ALTER TABLE `Company` ADD CONSTRAINT `Company_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `CompanySubscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
