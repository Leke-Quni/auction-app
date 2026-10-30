import { ConflictException } from "@nestjs/common";

export type ConflictCode = "EMAIL_TAKEN" | "USERNAME_TAKEN";

// The machine-readable code lets the web app say which field clashed.
export const conflict = (code: ConflictCode, message: string) => new ConflictException({ message, code });

export const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === "P2002";
