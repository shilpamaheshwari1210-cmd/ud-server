-- AlterTable
ALTER TABLE `banners` ADD COLUMN `countryId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `cms_pages` ADD COLUMN `countryId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `homepage_sections` ADD COLUMN `countryId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `countries` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `currencySymbol` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT false,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `countries_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_country_pricing` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `countryId` VARCHAR(191) NOT NULL,
    `basePrice` DECIMAL(10, 2) NOT NULL,
    `salePrice` DECIMAL(10, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_country_pricing_productId_countryId_key`(`productId`, `countryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_country_availability` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `countryId` VARCHAR(191) NOT NULL,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `product_country_availability_productId_countryId_key`(`productId`, `countryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `banners_countryId_idx` ON `banners`(`countryId`);

-- CreateIndex
CREATE INDEX `cms_pages_countryId_idx` ON `cms_pages`(`countryId`);

-- CreateIndex
CREATE INDEX `homepage_sections_countryId_idx` ON `homepage_sections`(`countryId`);

-- AddForeignKey
ALTER TABLE `banners` ADD CONSTRAINT `banners_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `homepage_sections` ADD CONSTRAINT `homepage_sections_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cms_pages` ADD CONSTRAINT `cms_pages_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_country_pricing` ADD CONSTRAINT `product_country_pricing_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_country_pricing` ADD CONSTRAINT `product_country_pricing_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_country_availability` ADD CONSTRAINT `product_country_availability_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_country_availability` ADD CONSTRAINT `product_country_availability_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
