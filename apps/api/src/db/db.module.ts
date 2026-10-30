import { createPrismaClient, PrismaClient } from "@auction/db";
import { Global, Module } from "@nestjs/common";
import "../config";

export const PRISMA = Symbol("PRISMA");
export type Prisma = PrismaClient;

@Global()
@Module({
  providers: [{ provide: PRISMA, useFactory: () => createPrismaClient() }],
  exports: [PRISMA],
})
export class DbModule {}
