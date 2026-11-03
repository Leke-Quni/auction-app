import { Global, Module } from "@nestjs/common";
import { FakePaymentProvider } from "./fake-payment-provider";
import { PAYMENT_PROVIDER } from "./payment-provider";

@Global()
@Module({ providers: [{ provide: PAYMENT_PROVIDER, useFactory: () => new FakePaymentProvider() }], exports: [PAYMENT_PROVIDER] })
export class PaymentsModule {}
