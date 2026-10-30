import { createPrismaClient, PrismaClient } from "@auction/db";
import { Global, Inject, Module, OnModuleDestroy } from "@nestjs/common";
import "../config";

export const PRISMA = Symbol("PRISMA");
export type Prisma = PrismaClient;

@Global()
@Module({
  providers: [{ provide: PRISMA, useFactory: () => createPrismaClient() }],
  exports: [PRISMA],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
