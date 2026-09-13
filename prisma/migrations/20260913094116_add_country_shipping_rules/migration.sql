-- CreateTable
CREATE TABLE `country_shipping_rules` (
    `id` VARCHAR(191) NOT NULL,
    `countryId` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `cost` DECIMAL(10, 2) NOT NULL,
    `freeShippingThreshold` DECIMAL(10, 2) NULL,
    `estimatedDaysMin` INTEGER NULL,
    `estimatedDaysMax` INTEGER NULL,
    `customsMessage` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `country_shipping_rules_countryId_method_key`(`countryId`, `method`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `country_shipping_rules` ADD CONSTRAINT `country_shipping_rules_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
