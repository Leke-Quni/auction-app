import { VIEWER_IP_HEADER, VIEWER_IP_SIGNATURE_HEADER } from "@auction/shared";
import { createHmac } from "node:crypto";

// This app does not pass on the visitor's address yet. It signs an empty one instead, so the API counts sign-ins per email only and
// not under this server's own address, which every admin shares.
export const noViewerIpHeaders = (): Record<string, string> => ({
  [VIEWER_IP_HEADER]: "",
  [VIEWER_IP_SIGNATURE_HEADER]: createHmac("sha256", process.env.AUTH_SECRET!).update("").digest("hex"),
});
