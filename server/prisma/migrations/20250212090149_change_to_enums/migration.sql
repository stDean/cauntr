/*
  Warnings:

  - The values [PREMIUM] on the enum `CompanySubscription_tier` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `CompanySubscription` MODIFY `tier` ENUM('PERSONAL', 'TEAM', 'ENTERPRISE') NOT NULL DEFAULT 'PERSONAL';
