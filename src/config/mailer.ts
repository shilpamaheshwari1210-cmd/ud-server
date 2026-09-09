import nodemailer, { Transporter } from 'nodemailer';
import { config } from './env';
import { logger } from '../utils/logger';

/**
 * Outbound mail, with two ways out of the building.
 *
 * Brevo's HTTP API is preferred when a key is present: it is a single HTTPS
 * POST, it answers in about a second, and when it refuses it says why
 * ("sender not verified" is the usual one). Their SMTP relay — or any other
 * SMTP server — is the fallback, and needs no code, only credentials.
 *
 * Nothing here is configured by default. Callers ask `isMailConfigured()`
 * first so a missing setup produces a useful message instead of a timeout.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 15_000;

export type MailProvider = 'BREVO_API' | 'SMTP' | 'NONE';

export function mailProvider(): MailProvider {
  if (config.brevo.apiKey) return 'BREVO_API';
  if (config.smtp.host && config.smtp.user && config.smtp.pass) return 'SMTP';
  return 'NONE';
}

export function isMailConfigured(): boolean {
  return mailProvider() !== 'NONE';
}

/** The env vars a deployer still has to fill in. Used in error messages. */
export function missingMailConfig(): string[] {
  if (isMailConfigured()) return [];
  // Only one route needs completing, so name the easier one rather than
  // listing every variable of both.
  return ['BREVO_API_KEY', 'or SMTP_HOST + SMTP_USER + SMTP_PASS'];
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Where replies should land. The From address is on the sending domain,
   * which has no MX records — mail to it bounces — so anything inviting a
   * reply must point somewhere a person actually reads.
   */
  replyTo?: string;
}

// ─── Brevo HTTP API ──────────────────────────────────────────────────────

async function sendViaBrevo({ to, subject, html, text, replyTo }: MailInput): Promise<void> {
  let res: Response;
  try {
    res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key':      config.brevo.apiKey,
        'content-type': 'application/json',
        accept:         'application/json',
      },
      body: JSON.stringify({
        sender:      { name: config.smtp.fromName, email: config.smtp.fromEmail },
        to:          [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        ...(replyTo && { replyTo: { email: replyTo } }),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err: any) {
    throw new Error(`Could not reach Brevo: ${err?.message ?? 'network error'}`);
  }

  if (res.ok) return;

  // Brevo answers failures with { code, message }. That message is the most
  // useful thing anyone gets when a send is refused, so it is carried through
  // rather than flattened into "email failed".
  const body = await res.text();
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    if (parsed?.message) detail = parsed.message;
  } catch { /* not JSON — the raw body is still better than nothing */ }

  if (res.status === 401) {
    throw new Error(`Brevo rejected the API key (${detail})`);
  }
  if (res.status === 400 && /sender/i.test(detail)) {
    throw new Error(
      `Brevo will not send from ${config.smtp.fromEmail}: ${detail}. ` +
      `Add that address as a verified sender in Brevo, or set FROM_EMAIL to one that is.`,
    );
  }
  throw new Error(`Brevo refused the message (${res.status}): ${detail}`);
}

// ─── SMTP (Brevo's relay, or anything else) ──────────────────────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      // 465 is implicit TLS; 587 upgrades with STARTTLS.
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

async function sendViaSmtp({ to, subject, html, text, replyTo }: MailInput): Promise<void> {
  const from = `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`;
  await getTransporter().sendMail({ from, to, subject, html, text, ...(replyTo && { replyTo }) });
}

// ─── Entry point ─────────────────────────────────────────────────────────

export async function sendMail(input: MailInput): Promise<void> {
  const provider = mailProvider();
  // Default every email to a mailbox that exists, unless a caller overrides it.
  const withReply: MailInput = { replyTo: config.smtp.replyTo || undefined, ...input };
  input = withReply;
  if (provider === 'NONE') {
    throw new Error(
      `Email is not configured on this server (set ${missingMailConfig().join(' ')})`,
    );
  }

  if (provider === 'BREVO_API') {
    await sendViaBrevo(input);
  } else {
    await sendViaSmtp(input);
  }

  // The address and provider are logged, never the body: OTP mails pass here.
  logger.info('Email sent', { to: input.to, subject: input.subject, provider });
}
