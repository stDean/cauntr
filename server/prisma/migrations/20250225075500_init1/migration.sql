/*
  Warnings:

  - You are about to drop the column `customerType` on the `paymentplan` table. All the data in the column will be lost.
  - Added the required column `tenantId` to the `Supplier` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `customer` ADD COLUMN `customerType` ENUM('CUSTOMER', 'DEBTOR') NOT NULL DEFAULT 'CUSTOMER';

-- AlterTable
ALTER TABLE `paymentplan` DROP COLUMN `customerType`;

-- AlterTable
ALTER TABLE `supplier` ADD COLUMN `companyId` VARCHAR(191) NULL,
    ADD COLUMN `tenantId` VARCHAR(191) NOT NULL;

-- AddForeignKey
ALTER TABLE `Supplier` ADD CONSTRAINT `Supplier_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
