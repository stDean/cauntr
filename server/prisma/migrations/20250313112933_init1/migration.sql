/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `supplier` ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `warehouseAddress` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Supplier_email_key` ON `Supplier`(`email`);
