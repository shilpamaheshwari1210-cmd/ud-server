-- AlterTable
ALTER TABLE `orders` ADD COLUMN `countryId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `orders_countryId_idx` ON `orders`(`countryId`);

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
