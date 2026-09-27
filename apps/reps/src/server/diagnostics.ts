import Stripe from "stripe";
import { HttpError } from "./types";

// Only staging administrators receive this bounded, redacted provider detail.
// Never include request bodies, headers, tax data, URLs, account IDs or credentials.
export function redactPaymentDetail(message: string) {
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, "[link]")
    .replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(
      /\b(?:sk|rk|pk)_(?:test|live)_[a-zA-Z0-9]+\b|\bwhsec_[a-zA-Z0-9]+\b/g,
      "[credential]",
    )
    .replace(
      /\b(?:acct|cus|pi|ch|pm|tok|ba|card|cs|seti|src)_[a-zA-Z0-9_]+\b/g,
      "[reference]",
    )
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, "[reference]")
    .replace(/\b\d[\d -]{5,}\d\b/g, "[number]")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 500);
}
// Ordinary responses contain classified messages and request references only.
export function paymentError(error: unknown, operation: string): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof Stripe.errors.StripeError) {
    const message = error.message.toLowerCase();
    const reference = /^req_[a-zA-Z0-9]+$/.test(error.requestId || "")
      ? error.requestId
      : undefined;
    let category = "PAYMENT_PROVIDER_UNAVAILABLE";
    let safe =
      "Payment setup could not be completed. Please retry or contact Pixelalty support.";
    if (
      /signed up for connect|sign up for connect|connect is not enabled/.test(
        message,
      )
    ) {
      category = "CONNECT_PLATFORM_NOT_ENABLED";
      safe =
        "Pixelalty needs to enable payout onboarding. Contact Pixelalty support; your information has not been lost.";
    } else if (
      /platform.profile|responsibilities|managing losses|complete.*platform|questionnaire/.test(
        message,
      )
    ) {
      category = "CONNECT_PLATFORM_PROFILE_REQUIRED";
      safe =
        "Pixelalty must finish its payout provider setup before you can continue. Please contact Pixelalty support.";
    } else if (
      error.type === "StripeAuthenticationError" ||
      error.type === "StripePermissionError"
    ) {
      category = "PAYMENT_PROVIDER_ACCESS";
      safe =
        "Pixelalty’s payment connection needs attention. Please contact Pixelalty support.";
    } else if (
      error.code === "resource_missing" &&
      operation.startsWith("connect")
    ) {
      category = "CONNECT_ACCOUNT_UNAVAILABLE";
      safe =
        "Your payout setup needs an administrator’s review. Contact Pixelalty support to reconnect it.";
    } else if (error.type === "StripeIdempotencyError") {
      category = "CONNECT_ATTEMPT_CONFLICT";
      safe =
        "A previous setup attempt needs to be reconciled by Pixelalty. Please contact support.";
    } else if (error.type === "StripeInvalidRequestError") {
      category =
        operation === "connect_link"
          ? "CONNECT_LINK_CONFIGURATION"
          : "PAYMENT_REQUEST_CONFIGURATION";
      safe =
        "Pixelalty’s payment setup needs attention before you can continue. Please contact support.";
    }
    return new HttpError(
      502,
      safe,
      category,
      reference,
      `${operation}: ${redactPaymentDetail(error.message)}`,
    );
  }
  return new HttpError(
    502,
    "The payment service could not be reached. Please try again.",
    "PAYMENT_NETWORK_ERROR",
  );
}
export async function paymentOperation<T>(
  operation: string,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    throw paymentError(error, operation);
  }
}
