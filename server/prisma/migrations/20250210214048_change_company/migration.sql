-- AlterTable
ALTER TABLE `Company` ADD COLUMN `nextBillingDate` TIMESTAMP(6) NULL,
    ADD COLUMN `pendingPlanUpdate` VARCHAR(255) NULL,
    ADD COLUMN `scheduledDeactivation` TIMESTAMP(6) NULL;
