import { z } from "zod";

const emailField = z.string().email("Enter a valid email");
const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");
const codeField = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");
const nameField = (label: string) =>
  z.string().trim().min(1, `Enter your ${label}`).max(40, `Your ${label} must be at most 40 characters`);

export const RESERVED_USERNAMES = ["admin", "administrator", "moderator", "root", "staff", "support", "system"];

export const usernameField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Username must be 3-20 characters and can only contain letters, numbers, and underscores")
  .refine((v) => !RESERVED_USERNAMES.includes(v), "That username is not available");

const passwordsMatch = {
  message: "Passwords do not match",
  path: ["confirmPassword"],
};

export const signUpSchema = z
  .object({
    firstName: nameField("first name"),
    lastName: nameField("last name"),
    username: usernameField,
    email: emailField,
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, passwordsMatch);

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password"),
});

export const loginCodeSchema = z.object({
  email: emailField,
  code: codeField,
});

export const forgotPasswordSchema = z.object({ email: emailField });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, passwordsMatch);

export const updateProfileSchema = z.object({
  firstName: nameField("first name"),
  lastName: nameField("last name"),
});

export const updateUsernameSchema = z.object({ username: usernameField });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "Your new password must be different from your current password",
    path: ["newPassword"],
  });

export const startEmailChangeSchema = z.object({
  newEmail: emailField,
  password: z.string().min(1, "Enter your password"),
});

export const confirmEmailChangeSchema = z.object({ code: codeField });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type LoginCodeInput = z.infer<typeof loginCodeSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateUsernameInput = z.infer<typeof updateUsernameSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type StartEmailChangeInput = z.infer<typeof startEmailChangeSchema>;
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;

export const USER_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];
