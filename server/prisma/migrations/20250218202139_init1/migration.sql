/*
  Warnings:

  - You are about to drop the column `customerType` on the `customer` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `paymentplan` table. All the data in the column will be lost.
  - You are about to drop the column `startDate` on the `paymentplan` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `customer` DROP COLUMN `customerType`;

-- AlterTable
ALTER TABLE `paymentplan` DROP COLUMN `endDate`,
    DROP COLUMN `startDate`,
    ADD COLUMN `customerType` ENUM('CUSTOMER', 'DEBTOR') NOT NULL DEFAULT 'CUSTOMER';
