import { BRAND, emailShell, codeBlock, note, esc } from './layout';

interface DeliveryCode {
  customerName: string;
  orderNumber: string;
  otp: string;
  minutesValid: number;
}

/**
 * Read at a doorstep, on a phone, with someone waiting — so the code comes
 * first and the warning is impossible to miss.
 *
 * The code is deliberately NOT in the subject: mail providers store and display
 * subjects in their dashboards, and anyone with that access could then confirm a
 * delivery that never happened, which is the whole thing this guards against.
 */
export function deliveryCodeEmail(d: DeliveryCode) {
  const subject = `Delivery code for order ${d.orderNumber}`;

  const body = `
<p style="margin:0 0 6px;font-size:15px;">Hi ${esc(d.customerName)},</p>
<p style="margin:0 0 4px;color:#4a4a4a;">
  Your delivery confirmation code for order
  <strong style="color:${BRAND.ink}">${esc(d.orderNumber)}</strong>:
</p>

${codeBlock(d.otp)}

<p style="margin:0 0 16px;color:#4a4a4a;">
  Give this code to the delivery person
  <strong style="color:${BRAND.ink}">only once the parcel is in your hands</strong>.
  It expires in ${d.minutesValid} minutes.
</p>

${note(
  `<strong style="color:#7a5c00">${esc(BRAND.name)} will never ask you for this code on a phone call</strong>,
   and will never ask for card, UPI or bank details. If no parcel has reached you, do not share it.`,
  'warn',
)}`.trim();

  const text = [
    `Hi ${d.customerName},`,
    '',
    `Your delivery confirmation code for order ${d.orderNumber}:`,
    '',
    `    ${d.otp}`,
    '',
    `Give this code to the delivery person ONLY once the parcel is in your hands.`,
    `It expires in ${d.minutesValid} minutes.`,
    '',
    `${BRAND.name} will never ask you for this code on a phone call, and will never`,
    `ask for card, UPI or bank details. If no parcel has reached you, do not share it.`,
    '',
    `${BRAND.name} · ${BRAND.site}`,
  ].join('\n');

  return {
    subject,
    text,
    html: emailShell({
      preheader: `Confirm delivery of order ${d.orderNumber}. Share only when the parcel is in hand.`,
      body,
    }),
  };
}
