import { getProfile } from "./accounts.js";
import { config } from "./config.js";
import { getLanguage } from "./languages.js";
import { logger } from "./logger.js";

export function emailConfigured() {
  return Boolean(config.resendApiKey);
}

export function whatsappConfigured() {
  return Boolean(config.whatsappToken && config.whatsappPhoneNumberId);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

export async function sendEmail({ to, subject, text, html }) {
  if (!emailConfigured() || !to) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text, html }),
  });
  if (!response.ok) throw new Error(`Email send failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return true;
}

/** WhatsApp Business: an approved template is required outside a 24h chat window, so it's used when configured. */
export async function sendWhatsApp({ phone, text, templateParams = [] }) {
  if (!whatsappConfigured() || !phone) return false;
  const to = String(phone).replace(/[^\d]/g, "");
  if (to.length < 8) return false;
  const message = config.whatsappTemplate
    ? {
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: config.whatsappTemplate,
        language: { code: config.whatsappTemplateLanguage },
        components: templateParams.length ? [{ type: "body", parameters: templateParams.map((value) => ({ type: "text", text: String(value).slice(0, 900) })) }] : [],
      },
    }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } };
  const response = await fetch(`https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.whatsappToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`WhatsApp send failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return true;
}

function jobMessage(job, event) {
  const name = job.original_filename || `Project #${job.id}`;
  const target = getLanguage(job.target_language)?.name || job.target_language;
  if (event === "done") {
    const link = `${config.frontendUrl}/result/${job.id}`;
    return { subject: `Your ${target} dub of "${name}" is ready`, line: `Your ${target} dub of "${name}" is ready to download.`, link, action: "Watch and download" };
  }
  if (event === "review") {
    const link = `${config.frontendUrl}/jobs/${job.id}/edit`;
    return { subject: `Review the ${target} translation of "${name}"`, line: `The ${target} translation of "${name}" is ready for your review before we generate the voice.`, link, action: "Review translation" };
  }
  const link = `${config.frontendUrl}/jobs/${job.id}`;
  return { subject: `We couldn't finish "${name}"`, line: `Processing "${name}" stopped: ${job.error_message || "an unexpected error"}. You can retry it from your project page.`, link, action: "Open project" };
}

/** Tells the creator their job finished, failed or needs review, on the channels they opted into. Never throws. */
export async function notifyJob(job, event) {
  if (!job?.user_id) return;
  try {
    const profile = await getProfile(job.user_id);
    if (!profile) return;
    const message = jobMessage(job, event);
    const tasks = [];
    if (profile.notify_email && profile.email) {
      tasks.push(sendEmail({
        to: profile.email,
        subject: message.subject,
        text: `${message.line}\n\n${message.action}: ${message.link}\n\n— ReelLingo`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#16124f"><h2 style="margin:0 0 12px">ReelLingo</h2><p style="font-size:15px;line-height:1.5">${escapeHtml(message.line)}</p><p><a href="${escapeHtml(message.link)}" style="display:inline-block;background:#2e2c90;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(message.action)}</a></p><p style="color:#6b6980;font-size:12px">You're receiving this because email notifications are on in your ReelLingo settings.</p></div>`,
      }));
    }
    if (profile.notify_whatsapp && profile.phone) {
      tasks.push(sendWhatsApp({ phone: profile.phone, text: `ReelLingo: ${message.line}\n${message.link}`, templateParams: [message.line, message.link] }));
    }
    const results = await Promise.allSettled(tasks);
    for (const result of results) if (result.status === "rejected") logger.warn({ err: result.reason, jobId: job.id }, "Notification failed");
  } catch (error) {
    logger.warn({ err: error, jobId: job.id }, "Notification failed");
  }
}
