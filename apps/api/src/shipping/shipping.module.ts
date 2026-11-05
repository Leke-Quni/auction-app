import { Global, Module } from "@nestjs/common";
import { FakeShippingProvider } from "./fake-shipping-provider";
import { SHIPPING_PROVIDER } from "./shipping-provider";

// No real carrier is integrated, so the fake one is always used.
@Global()
@Module({ providers: [{ provide: SHIPPING_PROVIDER, useFactory: () => new FakeShippingProvider() }], exports: [SHIPPING_PROVIDER] })
export class ShippingModule {}
