const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BUYING_INTENT = /\b(buy|checkout|pay|payment|price|cost|ready to start|how (?:do|can) i start|send (?:me )?the link|where do i sign)\b/i;
const ALLOWED_ROUTE_HOSTS = new Set(['growtheko.com', 'www.growtheko.com', 'robinekren.com', 'www.robinekren.com']);

function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function safeCanonicalRoute(value) {
  const raw = clean(value, 1000);
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://www.growtheko.com');
    if (url.protocol !== 'https:' || !ALLOWED_ROUTE_HOSTS.has(url.hostname.toLowerCase())) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function replyAction(replyTo) {
  const email = clean(replyTo, 320).toLowerCase();
  return {
    kind: 'reply',
    title: 'One honest reply',
    reminder: 'Send the one detail that feels most useful right now. We will continue from there.',
    label: 'reply',
    href: EMAIL.test(email) ? `mailto:${email}` : 'https://www.growtheko.com/contact'
  };
}

const STAGE_COPY = Object.freeze({
  connect: ['One easy start', 'Tell us what you are building and where you want the clearest help.'],
  context: ['What matters now', 'Reply with the outcome that matters most and what changed recently.'],
  diagnose: ['Find the real constraint', 'Reply with the one thing that is blocking progress right now.'],
  clarify: ['One missing detail', 'Reply with what you already tried and what happened next.'],
  recommend: ['Check the fit', 'Reply with what feels right, wrong or incomplete about this direction.'],
  follow_up: ['Still relevant?', 'Reply only if this is still worth solving. If the priority changed, say what changed.'],
  reopen: ['Pick it back up', 'Reply with what changed since we last spoke and we will continue from there.'],
  close_loop: ['Whenever it matters', 'If this becomes relevant again, reply with the current situation.'],
  understand: ['Start with the real thing', 'Reply with what feels most important for us to understand first.'],
  help: ['What would help most', 'Reply with what would make this conversation genuinely useful today.'],
  next_step: ['One next move', 'Reply with the result you want next and the biggest constraint you see.'],
  location: ['One profile detail', 'Reply with the city that should guide timing and local context.'],
  work: ['One profile detail', 'Reply with the work or role that is most relevant right now.'],
  birthday: ['One optional detail', 'Reply only if you want us to remember this future milestone.'],
  timezone: ['One timing detail', 'Reply with the time zone we should use for messages and scheduling.'],
  win: ['Name the win', 'Reply with the result from the current work that feels most useful.'],
  gap: ['Find the remaining gap', 'Reply with what still is not working the way you expected.'],
  fit: ['Check the next fit', 'Reply with the next outcome and the evidence that makes it a priority.'],
  permission: ['Your call', 'Reply yes if you want the smallest sensible next step mapped honestly.']
});

export function hasExplicitBuyingIntent(value) {
  return BUYING_INTENT.test(clean(value, 4000));
}

export function canonicalOperatorEmailAction({ path, stage, commercialNextStep, latestInboundContent, replyTo } = {}) {
  const currentStage = clean(stage, 40).toLowerCase();
  const route = safeCanonicalRoute(commercialNextStep?.route);
  const canUseCommercialRoute = path === 'start_to_sale'
    && currentStage === 'commit'
    && commercialNextStep?.active === true
    && hasExplicitBuyingIntent(latestInboundContent)
    && route;

  if (canUseCommercialRoute) {
    const applicationOnly = commercialNextStep.route_type === 'application';
    return {
      kind: applicationOnly ? 'application' : 'checkout',
      title: applicationOnly ? 'Your application' : 'Your next step',
      reminder: applicationOnly
        ? 'Review the scope once, then share the facts needed to check whether the engagement fits.'
        : 'Review the scope, outcome and investment once more before you decide.',
      label: applicationOnly ? 'apply' : 'continue',
      href: route
    };
  }

  const action = replyAction(replyTo);
  const copy = STAGE_COPY[currentStage];
  if (copy) [action.title, action.reminder] = copy;
  return action;
}

export function isCanonicalOperatorEmailAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const label = clean(value.label, 40);
  const title = clean(value.title, 120);
  const reminder = clean(value.reminder, 320);
  const href = clean(value.href, 1000);
  if (!['reply', 'continue', 'apply'].includes(label) || !title || !reminder || /\s/.test(label)) return false;
  if (href.startsWith('mailto:')) return EMAIL.test(href.slice(7));
  return Boolean(safeCanonicalRoute(href));
}
