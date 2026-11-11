import { Global, Module } from "@nestjs/common";
import Stripe from "stripe";
import { realStripePayouts, stripeConfig } from "../config";
import { DemoPayoutsProvider } from "./demo-payouts-provider";
import { FakePaymentProvider } from "./fake-payment-provider";
import { PAYMENT_PROVIDER } from "./payment-provider";
import { StripePaymentProvider } from "./stripe-payment-provider";

// A call to Stripe gives up after 8 seconds and is tried once more, so a slow Stripe fails a request cleanly (about 16 seconds) before the
// 20-second transaction that opens a checkout page times out, instead of Stripe's default of 80 seconds.
const STRIPE_TIMEOUT_MS = 8_000;

// Stripe when both keys are set (with payouts simulated unless `STRIPE_PAYOUTS=true`), the in-memory fake otherwise.
const createProvider = () => {
  const stripe = stripeConfig();
  if (!stripe) return new FakePaymentProvider();
  const real = new StripePaymentProvider(new Stripe(stripe.secretKey, { timeout: STRIPE_TIMEOUT_MS, maxNetworkRetries: 1 }), stripe.webhookSecret);
  return realStripePayouts() ? real : new DemoPayoutsProvider(real);
};

@Global()
@Module({ providers: [{ provide: PAYMENT_PROVIDER, useFactory: createProvider }], exports: [PAYMENT_PROVIDER] })
export class PaymentsModule {}
