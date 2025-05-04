/*
  Warnings:

  - A unique constraint covering the columns `[name,phone,companyId,tenantId]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,contact,companyId,tenantId]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `Customer_name_phone_key` ON `Customer`;

-- DropIndex
DROP INDEX `Supplier_name_contact_key` ON `Supplier`;

-- CreateIndex
CREATE UNIQUE INDEX `Customer_name_phone_companyId_tenantId_key` ON `Customer`(`name`, `phone`, `companyId`, `tenantId`);

-- CreateIndex
CREATE UNIQUE INDEX `Supplier_name_contact_companyId_tenantId_key` ON `Supplier`(`name`, `contact`, `companyId`, `tenantId`);
