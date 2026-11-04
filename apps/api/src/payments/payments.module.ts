import { Global, Module } from "@nestjs/common";
import Stripe from "stripe";
import { stripeConfig } from "../config";
import { FakePaymentProvider } from "./fake-payment-provider";
import { PAYMENT_PROVIDER } from "./payment-provider";
import { StripePaymentProvider } from "./stripe-payment-provider";

// Stripe when both keys are set, the in-memory fake otherwise.
const createProvider = () => {
  const stripe = stripeConfig();
  return stripe ? new StripePaymentProvider(new Stripe(stripe.secretKey), stripe.webhookSecret) : new FakePaymentProvider();
};

@Global()
@Module({ providers: [{ provide: PAYMENT_PROVIDER, useFactory: createProvider }], exports: [PAYMENT_PROVIDER] })
export class PaymentsModule {}
