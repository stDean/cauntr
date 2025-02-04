/*
  Warnings:

  - A unique constraint covering the columns `[payStackCustomerID]` on the table `CompanySubscription` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[payStackSubscriptionCode]` on the table `CompanySubscription` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `Company` DROP FOREIGN KEY `Company_subscriptionId_fkey`;

-- DropIndex
DROP INDEX `CompanySubscription_payStackCustomerID_payStackSubscriptionC_key` ON `companysubscription`;

-- CreateIndex
CREATE UNIQUE INDEX `CompanySubscription_payStackCustomerID_key` ON `CompanySubscription`(`payStackCustomerID`);

-- CreateIndex
CREATE UNIQUE INDEX `CompanySubscription_payStackSubscriptionCode_key` ON `CompanySubscription`(`payStackSubscriptionCode`);

-- AddForeignKey
ALTER TABLE `Company` ADD CONSTRAINT `Company_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `CompanySubscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
