/*
  Warnings:

  - You are about to drop the column `customerType` on the `customer` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `customer` DROP COLUMN `customerType`;

-- AlterTable
ALTER TABLE `paymentplan` ADD COLUMN `customerType` ENUM('CUSTOMER', 'DEBTOR') NOT NULL DEFAULT 'CUSTOMER';
