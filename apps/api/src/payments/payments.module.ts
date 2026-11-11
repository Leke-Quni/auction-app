import { Global, Module } from "@nestjs/common";
import Stripe from "stripe";
import { stripeConfig } from "../config";
import { FakePaymentProvider } from "./fake-payment-provider";
import { PAYMENT_PROVIDER } from "./payment-provider";
import { StripePaymentProvider } from "./stripe-payment-provider";

// A call to Stripe gives up after 8 seconds and is tried once more, so a slow Stripe fails a request cleanly (about 16 seconds) before the
// 20-second transaction that opens a checkout page times out, instead of Stripe's default of 80 seconds.
const STRIPE_TIMEOUT_MS = 8_000;

// Stripe when both keys are set, the in-memory fake otherwise.
const createProvider = () => {
  const stripe = stripeConfig();
  return stripe ? new StripePaymentProvider(new Stripe(stripe.secretKey, { timeout: STRIPE_TIMEOUT_MS, maxNetworkRetries: 1 }), stripe.webhookSecret) : new FakePaymentProvider();
};

@Global()
@Module({ providers: [{ provide: PAYMENT_PROVIDER, useFactory: createProvider }], exports: [PAYMENT_PROVIDER] })
export class PaymentsModule {}
