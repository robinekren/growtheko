export const GROWTHEKO_PUBLIC_EMAIL =
  process.env.GROWTHEKO_PUBLIC_EMAIL || 'info@growtheko.com';

export const GROWTHEKO_NOTIFY_EMAIL =
  process.env.GROWTHEKO_NOTIFY_EMAIL || 'robinekrenn@gmail.com';

export const GROWTHEKO_RESEND_FROM =
  process.env.RESEND_FROM ||
  process.env.GROWTHEKO_RESEND_FROM ||
  '';

export function sender(displayName = 'GrowthEko') {
  const configured = process.env.RESEND_FROM || process.env.GROWTHEKO_RESEND_FROM || GROWTHEKO_RESEND_FROM;
  const match = configured.match(/<([^>]+)>/);
  const currentBaseEmail = match ? match[1] : configured;
  if (!currentBaseEmail) {
    throw new Error('GrowthEko sender is not configured');
  }
  return `${displayName} <${currentBaseEmail}>`;
}
