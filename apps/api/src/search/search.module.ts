import { Global, Module } from "@nestjs/common";
import "../config";
import { createSearchIndex } from "./create-search-index";
import { SearchController } from "./search.controller";
import { SEARCH_INDEX } from "./search-index";

@Global()
@Module({
  controllers: [SearchController],
  providers: [{ provide: SEARCH_INDEX, useFactory: () => createSearchIndex() }],
  exports: [SEARCH_INDEX],
})
export class SearchModule {}
