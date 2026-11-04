import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JOB_VERIFIER, type JobVerifier } from "./job-scheduler";

// The job endpoints have no sign-in: anyone who could call them could close auctions on demand. The proof is QStash's
// signature over the raw body and the exact address it called, checked with the signing keys. Without QStash configured
// the endpoints do not exist.
@Injectable()
export class QStashSignatureGuard implements CanActivate {
  constructor(@Inject(JOB_VERIFIER) private readonly verifier: JobVerifier | null) {}

  async canActivate(context: ExecutionContext) {
    if (!this.verifier) throw new NotFoundException();
    const req = context.switchToHttp().getRequest<{ rawBody?: Buffer; originalUrl: string; headers: Record<string, string | undefined> }>();
    const signature = req.headers["upstash-signature"];
    if (!signature || !req.rawBody) throw new UnauthorizedException("Missing signature");
    if (!(await this.verifier.verify(req.rawBody.toString("utf8"), signature, `${this.verifier.callbackUrl}${req.originalUrl}`))) {
      throw new UnauthorizedException("Invalid signature");
    }
    return true;
  }
}
