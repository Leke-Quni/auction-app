import { Global, Module } from "@nestjs/common";
import { Client, Receiver } from "@upstash/qstash";
import { qstashConfig } from "../config";
import { InProcessJobScheduler, JOB_SCHEDULER, JOB_VERIFIER, type JobScheduler, type JobVerifier } from "./job-scheduler";
import { QStashJobScheduler } from "./qstash-job-scheduler";

const createScheduler = (): JobScheduler => {
  const config = qstashConfig();
  return config ? new QStashJobScheduler(new Client({ token: config.token, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) }), config.callbackUrl) : new InProcessJobScheduler();
};

const createVerifier = (): JobVerifier | null => {
  const config = qstashConfig();
  if (!config) return null;
  const receiver = new Receiver({ currentSigningKey: config.currentSigningKey, nextSigningKey: config.nextSigningKey, devMode: false });
  return {
    callbackUrl: config.callbackUrl,
    verify: async (body, signature, url) => {
      try {
        return await receiver.verify({ body, signature, url, clockTolerance: 5 });
      } catch {
        return false;
      }
    },
  };
};

// QStash when it is configured, the sweeps alone otherwise. Global so the services that create work to schedule (listings,
// closing, expiry) need no import.
@Global()
@Module({
  providers: [
    { provide: JOB_SCHEDULER, useFactory: createScheduler },
    { provide: JOB_VERIFIER, useFactory: createVerifier },
  ],
  exports: [JOB_SCHEDULER, JOB_VERIFIER],
})
export class JobSchedulerModule {}
