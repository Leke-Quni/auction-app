-- An auction can now be extended any number of times, up to a ceiling on its end time (see ANTI_SNIPING in packages/shared).
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_extensionCount_range";
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_extensionCount_range" CHECK ("extensionCount" >= 0);
