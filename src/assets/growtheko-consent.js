(() => {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "growtheko_consent_v1";
  const COOKIE_KEY = "growtheko_consent_v1";
  const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
  const OPTIONAL_CATEGORIES = ["analytics", "marketing"];
  const EVENT_NAME = "growtheko:consent-change";

  const defaultState = () => ({
    version: VERSION,
    necessary: true,
    analytics: false,
    marketing: false,
    decided: false,
    updatedAt: null,
  });

  const normalize = (candidate) => {
    if (!candidate || candidate.version !== VERSION) return defaultState();
    return {
      version: VERSION,
      necessary: true,
      analytics: candidate.analytics === true,
      marketing: candidate.marketing === true,
      decided: candidate.decided === true,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
    };
  };

  const readCookie = () => {
    const pair = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_KEY}=`));
    if (!pair) return null;
    const value = decodeURIComponent(pair.slice(COOKIE_KEY.length + 1));
    const match = /^v1\.a([01])\.m([01])\.(.+)$/.exec(value);
    if (!match) return null;
    return {
      version: VERSION,
      necessary: true,
      analytics: match[1] === "1",
      marketing: match[2] === "1",
      decided: true,
      updatedAt: match[3],
    };
  };

  const readState = () => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) return normalize(JSON.parse(stored));
    } catch (_) {
      // The first-party preference cookie remains as a fail-closed fallback.
    }
    return normalize(readCookie());
  };

  let state = readState();
  let root = null;
  let banner = null;
  let modal = null;
  let settingsButton = null;
  let previousFocus = null;
  let collisionFrame = 0;
  const suspendedFixedSurfaces = new Set();

  const fixedCtaSelector = [
    "[data-sticky-cta]",
    "[data-fixed-cta]",
    "[data-sticky-checkout]",
    ".sticky-cta",
    ".sticky-checkout",
    ".checkout-bar.sticky",
    ".mobile-sticky-cta",
  ].join(",");

  const getState = () => ({ ...state });
  const has = (category) => category === "necessary" || (state.decided && state[category] === true);

  const emitChange = (source) => {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {
      detail: { state: getState(), source },
    }));
  };

  const isVisibleBottomSurface = (element) => {
    if (!(element instanceof HTMLElement) || element === root || root?.contains(element)) return false;
    const style = window.getComputedStyle(element);
    const heldByConsentLayer = element.classList.contains("ge-consent-fixed-suspended");
    if (
      style.position !== "fixed" ||
      style.display === "none" ||
      (!heldByConsentLayer && (
        style.visibility === "hidden" ||
        Number.parseFloat(style.opacity || "1") < 0.05
      ))
    ) return false;

    const rect = element.getBoundingClientRect();
    const minimumWidth = Math.min(260, window.innerWidth * 0.55);
    const maximumHeight = Math.min(220, window.innerHeight * 0.4);
    return (
      rect.width >= minimumWidth &&
      rect.height > 24 &&
      rect.height <= maximumHeight &&
      rect.top < window.innerHeight - 20 &&
      rect.bottom >= window.innerHeight - 4
    );
  };

  const bottomFixedSurfaces = () => {
    const candidates = new Set(document.querySelectorAll(fixedCtaSelector));
    for (const child of document.body.children) candidates.add(child);
    return [...candidates].filter(isVisibleBottomSurface);
  };

  const syncFixedSurfaceCollision = () => {
    collisionFrame = 0;
    if (!root || !banner || !modal || !settingsButton) return;

    const surfaces = bottomFixedSurfaces();
    const privacyLayerOpen = !banner.hidden || !modal.hidden;
    const nextSuspended = new Set(privacyLayerOpen ? surfaces : []);

    for (const element of suspendedFixedSurfaces) {
      if (!nextSuspended.has(element)) element.classList.remove("ge-consent-fixed-suspended");
    }
    for (const element of nextSuspended) element.classList.add("ge-consent-fixed-suspended");
    suspendedFixedSurfaces.clear();
    for (const element of nextSuspended) suspendedFixedSurfaces.add(element);

    const clearance = privacyLayerOpen || settingsButton.hidden
      ? 0
      : surfaces.reduce((maximum, element) => {
          const rect = element.getBoundingClientRect();
          return Math.max(maximum, Math.ceil(window.innerHeight - rect.top + 12));
        }, 0);
    root.style.setProperty("--ge-consent-bottom-clearance", `${clearance}px`);
    root.dataset.geConsentCollision = clearance > 0 ? "true" : "false";
  };

  const scheduleFixedSurfaceCollision = () => {
    if (collisionFrame) return;
    collisionFrame = window.requestAnimationFrame(syncFixedSurfaceCollision);
  };

  const activateEligibleScripts = () => {
    document.querySelectorAll('script[type="text/plain"][data-consent-category]').forEach((blocked) => {
      const category = blocked.dataset.consentCategory;
      if (!OPTIONAL_CATEGORIES.includes(category) || !has(category) || blocked.dataset.consentActivated === "true") return;

      const active = document.createElement("script");
      for (const attribute of blocked.attributes) {
        if (["type", "data-src", "data-consent-category", "data-consent-activated"].includes(attribute.name)) continue;
        active.setAttribute(attribute.name, attribute.value);
      }
      if (blocked.dataset.src) active.src = blocked.dataset.src;
      if (!blocked.dataset.src) active.textContent = blocked.textContent;
      active.dataset.consentActivated = "true";
      blocked.dataset.consentActivated = "true";
      blocked.after(active);
    });
  };

  const writeState = (next, source) => {
    const previous = state;
    const updatedAt = new Date().toISOString();
    state = normalize({
      ...next,
      version: VERSION,
      necessary: true,
      decided: true,
      updatedAt,
    });

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Cookie fallback below preserves the user's decision where available.
    }

    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const compact = `v1.a${state.analytics ? "1" : "0"}.m${state.marketing ? "1" : "0"}.${updatedAt}`;
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(compact)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;

    renderState();
    activateEligibleScripts();
    emitChange(source);

    const withdrewActiveCategory = OPTIONAL_CATEGORIES.some((category) => previous[category] === true && state[category] !== true);
    if (withdrewActiveCategory) window.location.reload();
  };

  const closeModal = () => {
    if (!modal) return;
    modal.hidden = true;
    document.documentElement.classList.remove("ge-consent-modal-open");
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    scheduleFixedSurfaceCollision();
  };

  const openModal = () => {
    if (!modal) return;
    previousFocus = document.activeElement;
    modal.hidden = false;
    document.documentElement.classList.add("ge-consent-modal-open");
    modal.querySelector('[data-ge-consent="analytics"]').checked = state.analytics;
    modal.querySelector('[data-ge-consent="marketing"]').checked = state.marketing;
    modal.querySelector('[data-ge-consent-close]').focus();
    scheduleFixedSurfaceCollision();
  };

  const renderState = () => {
    if (!banner || !settingsButton) return;
    banner.hidden = state.decided;
    settingsButton.hidden = !state.decided;
    if (state.decided) closeModal();
    scheduleFixedSurfaceCollision();
  };

  const bindOpenControls = () => {
    document.querySelectorAll("[data-ge-consent-open]").forEach((control) => {
      if (control.dataset.geConsentBound === "true") return;
      control.dataset.geConsentBound = "true";
      control.addEventListener("click", openModal);
    });
  };

  const buildUi = () => {
    if (document.getElementById("ge-consent-root")) return;

    const style = document.createElement("style");
    style.textContent = `
      .ge-consent-visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
      #ge-consent-root,#ge-consent-root *{box-sizing:border-box}
      #ge-consent-root{--ge-ink:#111827;--ge-muted:#596174;--ge-line:#d9dde7;--ge-paper:#fff;--ge-soft:#f5f6f9;--ge-focus:#6246ea;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ge-ink);position:relative;z-index:2147483000}
      #ge-consent-root button,#ge-consent-root a{font:inherit}
      .ge-consent-banner{position:fixed;left:20px;right:20px;bottom:20px;max-width:1120px;margin:0 auto;padding:22px;border:1px solid rgba(17,24,39,.14);border-radius:20px;background:rgba(255,255,255,.98);box-shadow:0 20px 64px rgba(17,24,39,.22);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
      .ge-consent-banner[hidden],.ge-consent-modal[hidden],.ge-consent-settings[hidden]{display:none!important}
      .ge-consent-banner-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:22px;align-items:end}
      .ge-consent-eyebrow{margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#5d42d8}
      .ge-consent-title{margin:0 0 7px;font-size:21px;line-height:1.2;letter-spacing:-.025em;color:var(--ge-ink)}
      .ge-consent-copy{max-width:720px;margin:0;color:var(--ge-muted);font-size:14px;line-height:1.55}
      .ge-consent-copy a,.ge-consent-text-link{color:var(--ge-ink);text-decoration:underline;text-underline-offset:3px}
      .ge-consent-actions{display:grid;grid-template-columns:repeat(2,minmax(148px,1fr));gap:10px;min-width:326px}
      .ge-consent-button{min-height:44px;padding:10px 16px;border:1px solid var(--ge-ink);border-radius:12px;background:var(--ge-paper);color:var(--ge-ink);font-weight:750;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,background .16s ease}
      .ge-consent-button:hover{background:var(--ge-soft);transform:translateY(-1px)}
      .ge-consent-button:focus-visible,.ge-consent-settings:focus-visible,.ge-consent-close:focus-visible,.ge-consent-text-link:focus-visible{outline:3px solid rgba(98,70,234,.35);outline-offset:3px}
      .ge-consent-customize{grid-column:1/-1;border:0;background:transparent;color:var(--ge-ink);font-size:13px;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:5px}
      .ge-consent-settings{position:fixed;left:18px;bottom:calc(18px + var(--ge-consent-bottom-clearance,0px));min-height:42px;padding:9px 14px;border:1px solid rgba(17,24,39,.22);border-radius:999px;background:#fff;color:#111827;box-shadow:0 8px 28px rgba(17,24,39,.16);font-size:13px;font-weight:750;cursor:pointer;transition:bottom .22s ease,transform .16s ease,box-shadow .16s ease}
      html.ge-consent-modal-open .ge-consent-settings{opacity:0;visibility:hidden;pointer-events:none}
      .ge-consent-fixed-suspended{opacity:0!important;visibility:hidden!important;pointer-events:none!important}
      .ge-consent-modal{position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:rgba(7,10,18,.62)}
      .ge-consent-dialog{width:min(620px,100%);max-height:min(760px,calc(100vh - 40px));overflow:auto;border:1px solid rgba(255,255,255,.22);border-radius:22px;background:#fff;box-shadow:0 28px 90px rgba(0,0,0,.32)}
      .ge-consent-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:24px 24px 12px}
      .ge-consent-dialog-head h2{margin:0;font-size:25px;line-height:1.18;letter-spacing:-.035em;color:var(--ge-ink)}
      .ge-consent-close{width:40px;height:40px;border:1px solid var(--ge-line);border-radius:50%;background:#fff;color:var(--ge-ink);font-size:24px;line-height:1;cursor:pointer}
      .ge-consent-dialog-body{padding:0 24px 24px}
      .ge-consent-intro{margin:0 0 18px;color:var(--ge-muted);font-size:14px;line-height:1.55}
      .ge-consent-category{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px 0;border-top:1px solid var(--ge-line)}
      .ge-consent-category h3{margin:0 0 4px;font-size:16px;color:var(--ge-ink)}
      .ge-consent-category p{margin:0;color:var(--ge-muted);font-size:13px;line-height:1.5}
      .ge-consent-always{font-size:12px;font-weight:800;color:#26734d}
      .ge-consent-toggle{position:relative;width:50px;height:30px;display:inline-flex;flex:none}
      .ge-consent-toggle input{position:absolute;opacity:0;width:1px;height:1px}
      .ge-consent-slider{position:absolute;inset:0;border:1px solid #aeb5c2;border-radius:999px;background:#dfe3ea;cursor:pointer;transition:.18s ease}
      .ge-consent-slider::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 2px 7px rgba(0,0,0,.22);transition:.18s ease}
      .ge-consent-toggle input:checked + .ge-consent-slider{background:#111827;border-color:#111827}
      .ge-consent-toggle input:checked + .ge-consent-slider::after{transform:translateX(20px)}
      .ge-consent-toggle input:focus-visible + .ge-consent-slider{outline:3px solid rgba(98,70,234,.35);outline-offset:3px}
      .ge-consent-dialog-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding-top:18px;border-top:1px solid var(--ge-line)}
      .ge-consent-dialog-actions .ge-consent-save{grid-column:1/-1;background:#111827;color:#fff}
      .ge-consent-dialog-note{margin:16px 0 0;color:var(--ge-muted);font-size:12px;line-height:1.5}
      html.ge-consent-modal-open{overflow:hidden}
      @media(max-width:760px){.ge-consent-banner{left:10px;right:10px;bottom:10px;padding:18px;border-radius:18px}.ge-consent-banner-grid{grid-template-columns:1fr;gap:16px}.ge-consent-actions{min-width:0}.ge-consent-title{font-size:19px}.ge-consent-copy{font-size:13px}.ge-consent-settings{left:10px;bottom:calc(10px + var(--ge-consent-bottom-clearance,0px))}.ge-consent-dialog{border-radius:18px}.ge-consent-dialog-head{padding:20px 18px 10px}.ge-consent-dialog-body{padding:0 18px 20px}}
      @media(max-width:420px){.ge-consent-actions,.ge-consent-dialog-actions{grid-template-columns:1fr}.ge-consent-customize,.ge-consent-dialog-actions .ge-consent-save{grid-column:1}.ge-consent-button{width:100%}.ge-consent-category{gap:12px}}
      @media(prefers-reduced-motion:reduce){#ge-consent-root *{scroll-behavior:auto!important;transition:none!important}}
    `;
    document.head.appendChild(style);

    root = document.createElement("div");
    root.id = "ge-consent-root";
    root.innerHTML = `
      <section class="ge-consent-banner" aria-label="Privacy choices" aria-live="polite">
        <div class="ge-consent-banner-grid">
          <div>
            <p class="ge-consent-eyebrow">Your privacy choices</p>
            <h2 class="ge-consent-title">You decide what may run.</h2>
            <p class="ge-consent-copy">GrowthEko, operated by Robin Ekren, uses necessary storage to provide and secure this website. Optional analytics and marketing technologies stay off unless you allow them. Your choice is voluntary and can be changed at any time through “Privacy choices”. See our <a href="/privacy/">Privacy Policy</a> and <a href="/imprint/">Imprint</a>.</p>
          </div>
          <div class="ge-consent-actions">
            <button class="ge-consent-button" type="button" data-ge-consent-reject>Reject optional</button>
            <button class="ge-consent-button" type="button" data-ge-consent-accept>Accept optional</button>
            <button class="ge-consent-customize" type="button" data-ge-consent-open>Choose settings</button>
          </div>
        </div>
      </section>
      <button class="ge-consent-settings" type="button" data-ge-consent-open hidden>Privacy choices</button>
      <div class="ge-consent-modal" hidden>
        <section class="ge-consent-dialog" role="dialog" aria-modal="true" aria-labelledby="ge-consent-dialog-title">
          <div class="ge-consent-dialog-head">
            <div><p class="ge-consent-eyebrow">GrowthEko privacy</p><h2 id="ge-consent-dialog-title">Choose your settings</h2></div>
            <button class="ge-consent-close" type="button" data-ge-consent-close aria-label="Close privacy settings">×</button>
          </div>
          <div class="ge-consent-dialog-body">
            <p class="ge-consent-intro">Optional categories are off by default. Consent is the legal basis for any optional device storage and related processing. You can withdraw it here at any time without affecting earlier lawful processing.</p>
            <div class="ge-consent-category">
              <div><h3>Necessary</h3><p>Security, requested functions, sessions and your privacy-choice record. These cannot be switched off.</p></div>
              <span class="ge-consent-always">Always on</span>
            </div>
            <div class="ge-consent-category">
              <div><h3>Analytics</h3><p>Helps understand aggregate website use and improve the experience. No analytics tool is currently active.</p></div>
              <label class="ge-consent-toggle"><span class="ge-consent-visually-hidden">Allow analytics</span><input type="checkbox" data-ge-consent="analytics"><span class="ge-consent-slider" aria-hidden="true"></span></label>
            </div>
            <div class="ge-consent-category">
              <div><h3>Marketing</h3><p>Allows optional advertising measurement with Meta Pixel and the Meta Conversions API only when you consent and GrowthEko has enabled the service. This may share page and activity data, browser/device and IP information, and purchase event, value and currency. For a consented paid purchase, the server sends a normalized email only after SHA-256 hashing. See the Privacy Policy for details.</p></div>
              <label class="ge-consent-toggle"><span class="ge-consent-visually-hidden">Allow marketing</span><input type="checkbox" data-ge-consent="marketing"><span class="ge-consent-slider" aria-hidden="true"></span></label>
            </div>
            <div class="ge-consent-dialog-actions">
              <button class="ge-consent-button" type="button" data-ge-consent-reject>Reject optional</button>
              <button class="ge-consent-button" type="button" data-ge-consent-accept>Accept optional</button>
              <button class="ge-consent-button ge-consent-save" type="button" data-ge-consent-save>Save selected settings</button>
            </div>
            <p class="ge-consent-dialog-note">The first-party preference record is stored for up to 180 days so the site can remember your decision. More detail is available in the <a class="ge-consent-text-link" href="/privacy/">Privacy Policy</a>.</p>
          </div>
        </section>
      </div>
    `;
    document.body.appendChild(root);

    banner = root.querySelector(".ge-consent-banner");
    modal = root.querySelector(".ge-consent-modal");
    settingsButton = root.querySelector(".ge-consent-settings");

    root.querySelectorAll("[data-ge-consent-accept]").forEach((button) => {
      button.addEventListener("click", () => writeState({ analytics: true, marketing: true }, "accept-all"));
    });
    root.querySelectorAll("[data-ge-consent-reject]").forEach((button) => {
      button.addEventListener("click", () => writeState({ analytics: false, marketing: false }, "reject-all"));
    });
    root.querySelector("[data-ge-consent-save]").addEventListener("click", () => {
      writeState({
        analytics: root.querySelector('[data-ge-consent="analytics"]').checked,
        marketing: root.querySelector('[data-ge-consent="marketing"]').checked,
      }, "save-settings");
    });
    root.querySelectorAll("[data-ge-consent-open]").forEach((button) => button.addEventListener("click", openModal));
    root.querySelector("[data-ge-consent-close]").addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) closeModal(); });

    bindOpenControls();
    renderState();
    activateEligibleScripts();
    scheduleFixedSurfaceCollision();

    window.addEventListener("resize", scheduleFixedSurfaceCollision, { passive: true });
    window.addEventListener("orientationchange", scheduleFixedSurfaceCollision, { passive: true });
    window.addEventListener("scroll", scheduleFixedSurfaceCollision, { passive: true });
    document.addEventListener("transitionend", (event) => {
      if (!root.contains(event.target)) scheduleFixedSurfaceCollision();
    }, true);
    document.addEventListener("animationend", (event) => {
      if (!root.contains(event.target)) scheduleFixedSurfaceCollision();
    }, true);

    const observer = new MutationObserver((records) => {
      bindOpenControls();
      activateEligibleScripts();
      if (records.some((record) => !root.contains(record.target))) scheduleFixedSurfaceCollision();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "style"],
    });
  };

  window.GrowthEkoConsent = {
    version: VERSION,
    getState,
    has,
    open: openModal,
    onChange(callback) {
      if (typeof callback !== "function") return () => {};
      const handler = (event) => callback(event.detail);
      window.addEventListener(EVENT_NAME, handler);
      return () => window.removeEventListener(EVENT_NAME, handler);
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildUi, { once: true });
  else buildUi();

  if (state.decided) {
    activateEligibleScripts();
    emitChange("stored-choice");
  }
})();
