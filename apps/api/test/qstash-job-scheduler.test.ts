import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { MAX_DELAY_MS, QStashJobScheduler } from "../src/jobs/qstash-job-scheduler";
import { QStashSignatureGuard } from "../src/jobs/qstash-signature.guard";

const NOW = new Date("2026-11-04T12:00:00Z").getTime();

describe("QStashJobScheduler", () => {
  const publishJSON = vi.fn();
  const scheduler = () => new QStashJobScheduler({ publishJSON }, "https://api.example.com");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    publishJSON.mockReset();
    publishJSON.mockResolvedValue({ messageId: "m1" });
  });
  afterEach(() => vi.useRealTimers());

  it("publishes a close for just after the end time, to the job address", async () => {
    await scheduler().scheduleClose("L1", new Date(NOW + 3 * 3600_000));
    expect(publishJSON).toHaveBeenCalledWith({
      url: "https://api.example.com/jobs/close/L1",
      body: {},
      notBefore: Math.ceil((NOW + 3 * 3600_000 + 1000) / 1000),
      deduplicationId: `close-L1-${Math.ceil((NOW + 3 * 3600_000 + 1000) / 1000)}`,
    });
  });

  it("builds deduplication ids QStash accepts (no colon)", async () => {
    await scheduler().scheduleClose("L1", new Date(NOW + 3600_000));
    await scheduler().scheduleOrderExpiry("O1", new Date(NOW + 3600_000));
    for (const [request] of publishJSON.mock.calls) expect(request.deduplicationId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("publishes an order expiry for the payment deadline", async () => {
    await scheduler().scheduleOrderExpiry("O1", new Date(NOW + 48 * 3600_000));
    expect(publishJSON.mock.calls[0]![0]).toMatchObject({ url: "https://api.example.com/jobs/expire-order/O1", notBefore: Math.ceil((NOW + 48 * 3600_000 + 1000) / 1000) });
  });

  it("never sets a message further out than QStash's free plan allows, so a 30-day auction hops", async () => {
    await scheduler().scheduleClose("L1", new Date(NOW + 30 * 86_400_000));
    expect(publishJSON.mock.calls[0]![0].notBefore).toBe(Math.ceil((NOW + MAX_DELAY_MS) / 1000));
  });

  it("asks for an end time already past to run now", async () => {
    await scheduler().scheduleClose("L1", new Date(NOW - 3600_000));
    expect(publishJSON.mock.calls[0]![0].notBefore).toBe(Math.ceil(NOW / 1000));
  });

  it("uses a different deduplication id for a different moment, so an extension is not dropped", async () => {
    await scheduler().scheduleClose("L1", new Date(NOW + 3600_000));
    await scheduler().scheduleClose("L1", new Date(NOW + 3600_000 + 120_000));
    expect(publishJSON.mock.calls[0]![0].deduplicationId).not.toBe(publishJSON.mock.calls[1]![0].deduplicationId);
  });

  it("never throws for a time that is not a date", async () => {
    await expect(scheduler().scheduleClose("L1", new Date("nonsense"))).resolves.toBeUndefined();
    expect(publishJSON).not.toHaveBeenCalled();
  });

  it("never throws when QStash is unreachable: the sweep covers it", async () => {
    publishJSON.mockRejectedValue(new Error("network down"));
    await expect(scheduler().scheduleClose("L1", new Date(NOW + 3600_000))).resolves.toBeUndefined();
  });
});

describe("QStashSignatureGuard", () => {
  it("does not exist when QStash is not configured", async () => {
    await expect(new QStashSignatureGuard(null).canActivate({} as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});
