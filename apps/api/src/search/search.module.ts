import { Global, Module } from "@nestjs/common";
import "../config";
import { BidsModule } from "../bids/bids.module";
import { createSearchIndex } from "./create-search-index";
import { SearchController } from "./search.controller";
import { SearchSyncService } from "./search-sync.service";
import { SEARCH_INDEX } from "./search-index";

@Global()
@Module({
  imports: [BidsModule],
  controllers: [SearchController],
  providers: [{ provide: SEARCH_INDEX, useFactory: () => createSearchIndex() }, SearchSyncService],
  exports: [SEARCH_INDEX],
})
export class SearchModule {}
