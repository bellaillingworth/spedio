/**
 * analytics.js
 * ------------
 * Loads Google Analytics 4 (gtag.js) and exposes a small `trackEvent`
 * helper for app-specific events (transaction_saved, csv_uploaded,
 * pdf_uploaded, etc.).
 *
 * Configuration:
 *   The Measurement ID below is the default. Override at runtime by
 *   setting `window.SPENDIO_CONFIG.measurementId` in an inline script
 *   before this module loads.
 *
 *   Pageviews on `localhost` and `127.0.0.1` are skipped so dev
 *   activity doesn't pollute production data.
 */

const DEFAULT_MEASUREMENT_ID = "G-69LBJ39PM6";

const cfg = (typeof window !== "undefined" && window.SPENDIO_CONFIG) || {};
const MEASUREMENT_ID = cfg.measurementId || DEFAULT_MEASUREMENT_ID;

const isLocal =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "");

const enabled =
  !isLocal &&
  typeof MEASUREMENT_ID === "string" &&
  /^G-[A-Z0-9]+$/i.test(MEASUREMENT_ID);

if (enabled) {
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, {
    anonymize_ip: true,
    send_page_view: true,
  });
}

/**
 * Send a custom event to GA4. No-ops when analytics is disabled
 * (e.g. on localhost or when no Measurement ID is set), so callers
 * never need to guard.
 *
 * @param {string} name  Event name, e.g. "transaction_saved"
 * @param {object} [params] Event parameters (must be GA4-compatible
 *   primitives — strings, numbers, booleans).
 */
export function trackEvent(name, params = {}) {
  if (!enabled) return;
  if (typeof window.gtag !== "function") return;
  try {
    window.gtag("event", name, params);
  } catch (err) {
    console.warn("trackEvent failed", err);
  }
}

/** True once GA4 has been initialized for this page. */
export const analyticsEnabled = enabled;
