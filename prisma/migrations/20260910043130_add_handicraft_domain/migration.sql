-- AlterTable
ALTER TABLE `products` ADD COLUMN `artisanId` VARCHAR(191) NULL,
    ADD COLUMN `assemblyInstructions` TEXT NULL,
    ADD COLUMN `assemblyRequired` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `craftStory` LONGTEXT NULL,
    ADD COLUMN `customizationNotes` TEXT NULL,
    ADD COLUMN `finish` VARCHAR(191) NULL,
    ADD COLUMN `heightCm` DECIMAL(8, 2) NULL,
    ADD COLUMN `isCustomizable` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lengthCm` DECIMAL(8, 2) NULL,
    ADD COLUMN `manufacturingTimeDays` INTEGER NULL,
    ADD COLUMN `materialId` VARCHAR(191) NULL,
    ADD COLUMN `roomId` VARCHAR(191) NULL,
    ADD COLUMN `styleId` VARCHAR(191) NULL,
    ADD COLUMN `widthCm` DECIMAL(8, 2) NULL;

-- CreateTable
CREATE TABLE `materials` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `image` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `materials_slug_key`(`slug`),
    INDEX `materials_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `styles` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `image` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `styles_slug_key`(`slug`),
    INDEX `styles_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rooms` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `image` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rooms_slug_key`(`slug`),
    INDEX `rooms_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `artisans` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `bio` TEXT NULL,
    `photo` VARCHAR(191) NULL,
    `region` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `products_materialId_idx` ON `products`(`materialId`);

-- CreateIndex
CREATE INDEX `products_styleId_idx` ON `products`(`styleId`);

-- CreateIndex
CREATE INDEX `products_roomId_idx` ON `products`(`roomId`);

-- CreateIndex
CREATE INDEX `products_artisanId_idx` ON `products`(`artisanId`);

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `styles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_artisanId_fkey` FOREIGN KEY (`artisanId`) REFERENCES `artisans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
