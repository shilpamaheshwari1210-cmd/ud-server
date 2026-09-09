-- Was `slug UNIQUE` alone on cms_pages, which blocked a country-specific
-- override from ever existing under the same slug as the global page.
-- Replaced with a unique index on (slug, countryId).
ALTER TABLE `cms_pages` DROP INDEX `cms_pages_slug_key`;
ALTER TABLE `cms_pages` ADD UNIQUE INDEX `cms_pages_slug_countryId_key` (`slug`, `countryId`);
