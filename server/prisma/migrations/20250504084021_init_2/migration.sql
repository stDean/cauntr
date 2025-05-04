/*
  Warnings:

  - A unique constraint covering the columns `[serialNo,companyId,tenantId]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `Product_serialNo_key` ON `Product`;

-- CreateIndex
CREATE UNIQUE INDEX `Product_serialNo_companyId_tenantId_key` ON `Product`(`serialNo`, `companyId`, `tenantId`);
