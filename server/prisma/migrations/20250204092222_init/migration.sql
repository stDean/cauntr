-- CreateTable
CREATE TABLE `Company` (
    `id` VARCHAR(191) NOT NULL,
    `company_name` VARCHAR(191) NOT NULL,
    `company_email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `canUpdate` BOOLEAN NOT NULL DEFAULT true,
    `canCancel` BOOLEAN NOT NULL DEFAULT true,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `paymentStatus` ENUM('ACTIVE', 'INACTIVE', 'PENDING') NOT NULL DEFAULT 'PENDING',
    `subscriptionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Company_company_email_key`(`company_email`),
    UNIQUE INDEX `Company_subscriptionId_key`(`subscriptionId`),
    INDEX `Company_company_email_idx`(`company_email`),
    INDEX `Company_id_idx`(`id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanySubscription` (
    `id` VARCHAR(191) NOT NULL,
    `payStackCustomerID` VARCHAR(191) NOT NULL,
    `payStackSubscriptionCode` VARCHAR(191) NULL,
    `tier` ENUM('PERSONAL', 'PREMIUM', 'ENTERPRISE') NOT NULL DEFAULT 'PERSONAL',
    `tierType` ENUM('MONTHLY', 'YEARLY') NOT NULL DEFAULT 'MONTHLY',
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompanySubscription_id_idx`(`id`),
    UNIQUE INDEX `CompanySubscription_payStackCustomerID_payStackSubscriptionC_key`(`payStackCustomerID`, `payStackSubscriptionCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Otp` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `otp` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `verified` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Company` ADD CONSTRAINT `Company_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `CompanySubscription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
