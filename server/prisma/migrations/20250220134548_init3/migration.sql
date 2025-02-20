-- DropForeignKey
ALTER TABLE `transaction` DROP FOREIGN KEY `Transaction_customerId_fkey`;

-- DropIndex
DROP INDEX `Transaction_customerId_fkey` ON `transaction`;

-- AlterTable
ALTER TABLE `product` MODIFY `supplierId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `transaction` MODIFY `customerId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
