import { config } from '../config/env';

/**
 * One shell for every email the shop sends.
 *
 * Email clients are not browsers: Gmail strips <style> blocks, Outlook renders
 * through Word, and flexbox and grid are unavailable. So this is tables and
 * inline styles throughout — verbose, but it is the only thing that renders the
 * same in Gmail, Outlook, Apple Mail and on a phone.
 *
 * Colours track the storefront theme (black + gold) rather than being invented
 * here, so an email and the site look like the same shop.
 */

export const BRAND = {
  name: 'Unique Dressup',
  tagline: 'Express Your Unique Style',
  site: 'https://theuniquedressup.com',
  logo: 'https://theuniquedressup.com/logo-mark-light.png',
  instagram: 'https://www.instagram.com/uniquedressup.inn',
  supportEmail: 'uniquedressup1094@gmail.com',
  ink: '#1a1a1a',
  gold: '#c9a84c',
  paper: '#f6f4f1',
  muted: '#6b6b6b',
  line: '#e6e3de',
};

export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface ShellOptions {
  /** Sits in the inbox preview line, next to the subject. */
  preheader: string;
  body: string;
}

export function emailShell({ preheader, body }: ShellOptions): string {
  return `<!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">
  ${esc(preheader)}
</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:${BRAND.paper};margin:0;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="max-width:520px;background:#ffffff;border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden;">

      <!-- Masthead -->
      <tr>
        <td align="center" style="background:${BRAND.ink};padding:26px 24px 22px;">
          <img src="${BRAND.logo}" alt="${esc(BRAND.name)}" width="150"
               style="display:block;border:0;max-width:150px;height:auto;margin:0 auto 10px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:.22em;
                      text-transform:uppercase;color:${BRAND.gold};">
            ${esc(BRAND.tagline)}
          </div>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:32px 30px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                   font-size:15px;line-height:1.6;color:#2b2b2b;">
          ${body}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#fafafa;border-top:1px solid ${BRAND.line};padding:22px 30px;
                   font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                   font-size:12px;line-height:1.7;color:${BRAND.muted};" align="center">
          <a href="${BRAND.site}" style="color:${BRAND.ink};font-weight:700;text-decoration:none;">theuniquedressup.com</a>
          &nbsp;·&nbsp;
          <a href="${BRAND.instagram}" style="color:${BRAND.ink};font-weight:700;text-decoration:none;">Instagram</a>
          <div style="margin-top:8px;">
            Questions? Reply to this email or message us on Instagram.
          </div>
          <div style="margin-top:10px;color:#9a9a9a;font-size:11px;">
            © ${new Date().getFullYear()} ${esc(BRAND.name)}. All rights reserved.
          </div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`;
}

/** The code block. Big, monospaced, and spaced so it can be read aloud or copied. */
export function codeBlock(code: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0;">
  <tr>
    <td align="center" style="background:${BRAND.ink};border-radius:12px;padding:20px 12px;">
      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;line-height:1.1;
                  font-weight:700;letter-spacing:12px;color:#ffffff;text-indent:12px;">
        ${esc(code)}
      </div>
    </td>
  </tr>
</table>`;
}

/** A quiet aside — expiry, security notes. */
export function note(html: string, tone: 'plain' | 'warn' = 'plain'): string {
  const bg = tone === 'warn' ? '#fff8e8' : '#f7f7f7';
  const bar = tone === 'warn' ? BRAND.gold : BRAND.line;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 0;">
  <tr>
    <td style="background:${bg};border-left:3px solid ${bar};border-radius:6px;padding:12px 14px;
               font-size:13px;line-height:1.6;color:#5a5a5a;">
      ${html}
    </td>
  </tr>
</table>`;
}
