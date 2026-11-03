-- A waiting outbid email is leased while it is being sent and only deleted once the email has gone.
ALTER TABLE "PendingOutbidEmail" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;
