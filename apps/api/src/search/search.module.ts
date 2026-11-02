import { Global, Module } from "@nestjs/common";
import "../config";
import { createSearchIndex } from "./create-search-index";
import { SEARCH_INDEX } from "./search-index";

@Global()
@Module({
  providers: [{ provide: SEARCH_INDEX, useFactory: () => createSearchIndex() }],
  exports: [SEARCH_INDEX],
})
export class SearchModule {}
