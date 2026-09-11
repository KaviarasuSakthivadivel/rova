import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { env } from "@/config";

export interface SendEmailParams {
  to: string;
  subject: string;
  react: ReactElement;
}

export interface SendEmailResult {
  sent: boolean;
  reason?: string;
}

/**
 * Thin wrapper over Resend's REST API via plain fetch — no SDK dependency,
 * keeps the compiled binary lean. No-ops (with a warning, not a crash) when
 * RESEND_API_KEY isn't configured, so local dev/tests never need real
 * credentials to exercise the rest of the digest pipeline.
 */
export async function sendEmail({ to, subject, react }: SendEmailParams): Promise<SendEmailResult> {
  const html = await render(react);

  if (!env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set — skipping send to ${to} ("${subject}")`);
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.DIGEST_FROM_EMAIL ?? "digest@example.com",
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend send failed (${response.status}): ${body}`);
  }

  return { sent: true };
}
