// The web server tells the API which address a bid really came from (it is the one calling the API, not the bidder's
// browser). The address travels with a signature made with the shared secret, so nobody else can make one up.
export const VIEWER_IP_HEADER = "x-viewer-ip";
export const VIEWER_IP_SIGNATURE_HEADER = "x-viewer-ip-signature";
