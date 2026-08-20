import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.VISION_BASE_URL || 'http://localhost:3004';
const assetsDir = join(__dirname, 'assets');

const screens = [
  ['01-traffic-start.png', '/start', '1440,5400'],
  ['02-attention-webinar.png', '/webinar', '1440,2800'],
  ['03-funnel-apply.png', '/apply#applicationForm', '1440,3200'],
  ['04-interest-playbook.png', '/playbook', '1440,2100'],
  ['05a-onboard-verify.png', '/onboard?visionStep=verify', '1440,1700'],
  ['05b-onboard-about.png', '/onboard?visionStep=about', '1440,1700'],
  ['05c-onboard-market.png', '/onboard?visionStep=market', '1440,1700'],
  ['05d-onboard-audience.png', '/onboard?visionStep=audience', '1440,1700'],
  ['05e-onboard-product.png', '/onboard?visionStep=product', '1440,1700'],
  ['05f-onboard-status.png', '/onboard?visionStep=status', '1440,1700'],
  ['05g-onboard-goals.png', '/onboard?visionStep=goals', '1440,1700'],
  ['05h-onboard-tech.png', '/onboard?visionStep=tech', '1440,1700'],
  ['05i-onboard-legal.png', '/onboard?visionStep=legal', '1440,1700'],
  ['05j-onboard-review.png', '/onboard?visionStep=review', '1440,1700'],
  ['06-action-success.png', '/success', '1440,1000'],
  ['07-delivery-portal.png', '/portal', '1440,1380'],
  ['07b-learning-library.png', '/learning', '1440,1700'],
  ['07c-chat-rayan.png', '/chat', '1440,1100'],
  ['08-result-portal.png', '/portal#result', '1440,1380'],
  ['09a-crm-auth.png', '/crm', '1440,1200'],
  ['09b-crm-dashboard.png', '/crm?vision=dashboard', '1440,1200'],
  ['09c-crm-callscript.png', '/crm?vision=callscript', '1440,1200'],
  ['09d-crm-outreach.png', '/crm?vision=outreach', '1440,1200'],
  ['10-loyalty-login-portal.png', '/login-portal', '1440,1000'],
  ['11-testimonial.png', '/testimonial', '1440,1830']
];

for (const [file, path, size] of screens) {
  const out = join(assetsDir, file);
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${size}`,
    '--timeout=3000',
    `--screenshot=${out}`,
    `${baseUrl}${path}`
  ], { stdio: 'ignore' });
  console.log(`${file} <- ${baseUrl}${path}`);
}
