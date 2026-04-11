import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";
import type { ErrorSignature, ProjectRepo, RemedyPR } from "./types.js";

let mailer: Transporter | null = null;

function getMailer(): Transporter | null {
  if (!env.smtpHost) return null;
  if (!mailer) {
    mailer = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth:
        env.smtpUser && env.smtpPass
          ? { user: env.smtpUser, pass: env.smtpPass }
          : undefined,
    });
  }
  return mailer;
}

async function postSlack(
  webhookUrl: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slack webhook failed: ${res.status} ${text}`);
  }
}

export async function notifySuccess(
  repo: ProjectRepo,
  sig: ErrorSignature,
  pr: RemedyPR,
  agentSummary: string,
): Promise<void> {
  const webhook = repo.slackWebhookUrl || env.slackWebhookUrl;
  const title = `🩹 Remedy opened a PR for ${sig.errorType} in ${sig.file}:${sig.line}`;
  const summary = agentSummary.slice(0, 1500);

  if (webhook) {
    try {
      await postSlack(webhook, {
        text: title,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "🩹 Remedy auto-fix" },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*<${pr.url}|PR #${pr.number}>* opened as draft\n*File:* \`${sig.file}:${sig.line}\`\n*Error:* \`${sig.errorType}\` — ${sig.occurrences} occurrences across ${sig.uniqueSessions} sessions`,
            },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: summary },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Project: \`${sig.projectId}\` · Branch: \`${pr.branch}\``,
              },
            ],
          },
        ],
      });
    } catch (err) {
      console.error("[remedy] slack notify failed:", err);
    }
  }

  const mail = getMailer();
  if (mail && repo.notifyEmails.length > 0) {
    try {
      await mail.sendMail({
        from: env.smtpFrom,
        to: repo.notifyEmails.join(","),
        subject: title,
        text: `${pr.url}\n\n${summary}`,
        html: `<p><a href="${pr.url}">${pr.url}</a></p><pre>${summary
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</pre>`,
      });
    } catch (err) {
      console.error("[remedy] email notify failed:", err);
    }
  }
}

export async function notifyFailure(
  repo: ProjectRepo,
  sig: ErrorSignature,
  reason: string,
): Promise<void> {
  const webhook = repo.slackWebhookUrl || env.slackWebhookUrl;
  if (!webhook) return;

  try {
    await postSlack(webhook, {
      text: `⚠️ Remedy failed to fix ${sig.errorType} in ${sig.file}:${sig.line}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*⚠️ Remedy attempt failed*\n*File:* \`${sig.file}:${sig.line}\`\n*Error:* \`${sig.errorType}\` (${sig.occurrences}×)\n*Reason:* ${reason.slice(0, 500)}`,
          },
        },
      ],
    });
  } catch (err) {
    console.error("[remedy] slack failure notify failed:", err);
  }
}
