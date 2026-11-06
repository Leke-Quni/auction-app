import { z } from "zod";

export const SUPPORT_MESSAGE_MAX = 2000;
// Five requests a day per person: enough for a real problem, not enough to bury the queue.
export const SUPPORT_RATE_LIMIT = { limit: 5, windowSeconds: 86_400 } as const;

export const supportRequestSchema = z
  .object({
    kind: z.enum(["GENERAL", "STRIKE_APPEAL"]),
    strikeId: z.string().min(1).optional(),
    message: z.string().trim().min(1, "Write your message").max(SUPPORT_MESSAGE_MAX, `At most ${SUPPORT_MESSAGE_MAX} characters`),
  })
  .superRefine((request, ctx) => {
    if (request.kind === "STRIKE_APPEAL" && !request.strikeId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["strikeId"], message: "Choose the strike you are appealing" });
  });
export type SupportRequestInput = z.infer<typeof supportRequestSchema>;

// One of the signed-in person's own strikes, for the appeal form.
export interface SupportStrike {
  id: string;
  createdAt: string;
  reason: string | null;
  givenByAdmin: boolean;
  listingTitle: string | null;
  appealed: boolean;
}
