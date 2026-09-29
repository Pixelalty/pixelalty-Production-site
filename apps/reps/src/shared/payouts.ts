import { z } from "zod";
import { normalizePhone } from "./core";

const legalName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (s) =>
      [...s].every(
        (c) =>
          c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127 && !"<>".includes(c),
      ),
    "Enter a legal name without control characters.",
  );
export const payoutInput = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    phone: z
      .string()
      .trim()
      .min(10)
      .max(30)
      .transform((s, ctx) => {
        try {
          return normalizePhone(s);
        } catch {
          ctx.addIssue({
            code: "custom",
            message: "Enter a valid phone number with country code.",
          });
          return z.NEVER;
        }
      }),
    legal_first_name: legalName,
    legal_last_name: legalName,
    acknowledged: z.literal(true),
  })
  .strict();
export const payoutLabels: Record<string, string> = {
  not_started: "Not started",
  submitted: "Submitted — awaiting Stripe setup",
  stripe_setup_pending: "Stripe setup pending",
  ready: "Payout setup complete",
  needs_correction: "Update required",
};
export const payoutMessages: Record<string, string> = {
  not_started:
    "Set up your payout information so you can receive eligible commissions.",
  submitted:
    "Thank you. Please allow up to 24 hours for Pixelalty to process your submission and initiate secure Stripe payout setup. Stripe will then email you directly with instructions. Check your inbox and Spam/Junk folder.",
  stripe_setup_pending:
    "Stripe has been instructed to collect your payout details securely. Check your email and Spam/Junk folder for a message from Stripe and follow its instructions. Pixelalty will review readiness after you finish.",
  ready:
    "Your Stripe payout setup has been approved by Pixelalty. You are ready to receive eligible commission payouts.",
  needs_correction:
    "Please update the information requested below and resubmit it for review.",
};
