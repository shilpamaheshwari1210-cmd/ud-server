import { BRAND, emailShell, codeBlock, note, esc } from './layout';

interface SignInCode {
  firstName?: string | null;
  otp: string;
  minutesValid: number;
  /** A first-time code reads as a welcome; a returning one should not. */
  isNewUser: boolean;
}

/**
 * The sign-in code. This is the only thing standing between a customer and
 * their account, so the code is the first thing in the mail, in the subject,
 * and in the preview line — before any greeting.
 */
export function signInCodeEmail(d: SignInCode) {
  const greeting = d.firstName ? `Hi ${esc(d.firstName)},` : 'Hi there,';
  const subject = d.isNewUser
    ? `${d.otp} — confirm your email to join ${BRAND.name}`
    : `${d.otp} — your ${BRAND.name} sign-in code`;

  const lead = d.isNewUser
    ? `Welcome to <strong style="color:${BRAND.ink}">${esc(BRAND.name)}</strong>. Enter this code to finish creating your account:`
    : `Enter this code to sign in to your account:`;

  const body = `
<p style="margin:0 0 6px;font-size:15px;">${greeting}</p>
<p style="margin:0 0 4px;color:#4a4a4a;">${lead}</p>

${codeBlock(d.otp)}

<p style="margin:0 0 16px;color:#4a4a4a;">
  This code expires in <strong style="color:${BRAND.ink}">${d.minutesValid} minutes</strong>
  and can be used once.
</p>

${note(
  `Didn't request this? You can ignore this email — nobody can sign in without the code,
   and we will never ask you for it by phone or message.`,
)}`.trim();

  const text = [
    greeting,
    '',
    d.isNewUser
      ? `Welcome to ${BRAND.name}. Enter this code to finish creating your account:`
      : `Enter this code to sign in to your account:`,
    '',
    `    ${d.otp}`,
    '',
    `This code expires in ${d.minutesValid} minutes and can be used once.`,
    '',
    `Didn't request this? You can ignore this email — nobody can sign in without`,
    `the code, and we will never ask you for it by phone or message.`,
    '',
    `${BRAND.name} · ${BRAND.site}`,
  ].join('\n');

  return {
    subject,
    text,
    html: emailShell({
      preheader: `${d.otp} is your code. It expires in ${d.minutesValid} minutes.`,
      body,
    }),
  };
}
