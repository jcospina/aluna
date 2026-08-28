// @ts-check
//
// The developer preview's glue (src/app/region-lifecycle-preview.ts). It drives the real
// release scope and the real records-region request coordinator — nothing here is a
// stand-in — against a read that deliberately takes its time, so the release is slow
// enough to watch.

import { recordsRegionRequestCoordinator } from "./records-region-requests.js";
import { regionScopeReport, releaseRegionContent } from "./region-scope.js";

const READ_URL = "/demo/region-lifecycle/read";
const READERS_URL = "/demo/region-lifecycle/readers";
const DRAIN_URL = "/demo/region-lifecycle/drain";
const READERS_POLL_MS = 250;

/** @param {string} selector @returns {HTMLElement} */
function required(selector) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Preview is missing ${selector}.`);
  return element;
}

const host = required("[data-preview-window]");
const scopeReadout = required("[data-preview-scope]");
const readersReadout = required("[data-preview-readers]");
const drainStatus = required("[data-preview-drain-status]");

/** The region the preview creates and destroys, the way the window will. */
function ensureRegion() {
  const existing = host.querySelector('[data-content-region="preview window"]');
  if (existing instanceof HTMLElement) return existing;
  const region = document.createElement("div");
  region.dataset.contentRegion = "preview window";
  host.append(region);
  return region;
}

function paintScope() {
  const entries = regionScopeReport();
  scopeReadout.textContent =
    entries.length === 0
      ? "empty"
      : entries.map(({ region, label }) => `${region} · ${label}`).join("\n");
}

async function paintReaders() {
  const response = await fetch(READERS_URL).catch(() => null);
  if (response === null || !response.ok) {
    readersReadout.textContent = "unavailable";
    return;
  }
  const { readers } = /** @type {{ readers: { readerCount: number }[] }} */ (await response.json());
  const total = readers.reduce((sum, gate) => sum + gate.readerCount, 0);
  readersReadout.textContent = `${total} reader(s)\n${JSON.stringify(readers, null, 2)}`;
}

function holdMs() {
  const field = document.querySelector("[data-preview-hold]");
  return field instanceof HTMLInputElement ? field.value : "";
}

/** @param {"list" | "record"} view */
async function show(view) {
  const region = ensureRegion();
  // Replacing the content is one of the two release paths. Saying so before the swap is
  // what lets a request still in flight be aborted while its node is connected.
  releaseRegionContent(region);

  const node = document.createElement("section");
  node.className = "preview-view";
  node.dataset.previewView = view;
  node.textContent = `Reading the ${view}…`;
  region.replaceChildren(node);

  const claim = recordsRegionRequestCoordinator(node).claim();
  paintScope();
  try {
    const url = `${READ_URL}?view=${view}&ms=${encodeURIComponent(holdMs())}`;
    const response = await fetch(url, { headers: { "HX-Request": "true" }, signal: claim.signal });
    if (!claim.isCurrent()) return;
    node.innerHTML = await response.text();
  } catch {
    if (claim.isCurrent()) node.textContent = `The ${view} read was released before it settled.`;
  } finally {
    claim.release();
    paintScope();
  }
}

/** @param {number} ms */
function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Close the gate and wait it out, ticking while it waits. The wait is the whole point, so
 * the elapsed time keeps moving on the page rather than appearing all at once at the end.
 */
async function drain() {
  const startedAt = performance.now();
  const ticking = setInterval(() => {
    drainStatus.textContent = `Draining — waited ${seconds(performance.now() - startedAt)} so far.`;
  }, 100);
  try {
    const response = await fetch(DRAIN_URL, { method: "POST" });
    const report =
      /** @type {{ outcome: string, waitedMs: number, previousDeadlineMs: number, deadlineMs: number }} */ (
        await response.json()
      );
    if (report.outcome === "already_closing") {
      drainStatus.textContent = "A drain is already running.";
      return;
    }
    const waited = seconds(report.waitedMs);
    const past =
      report.waitedMs > report.previousDeadlineMs
        ? ` — past the old ${seconds(report.previousDeadlineMs)} deadline, which would have refused it`
        : "";
    drainStatus.textContent =
      report.outcome === "drained"
        ? `Drained after ${waited}${past}. The gate is open again.`
        : `Gave up after ${waited}: deletion_drain_timeout at the ${seconds(report.deadlineMs)} deadline.`;
  } catch {
    drainStatus.textContent = "The drain request never answered.";
  } finally {
    clearInterval(ticking);
    void paintReaders();
  }
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const trigger = target.closest("[data-preview-show]");
  if (trigger instanceof HTMLElement) {
    void show(trigger.dataset.previewShow === "record" ? "record" : "list");
    return;
  }

  if (target.closest("[data-preview-away]")) {
    // Removing the region is the other release path, and it is the same call.
    const region = host.querySelector('[data-content-region="preview window"]');
    if (region instanceof HTMLElement) {
      releaseRegionContent(region);
      region.remove();
    }
    paintScope();
    return;
  }

  if (target.closest("[data-preview-back]")) {
    ensureRegion();
    paintScope();
    return;
  }

  if (target.closest("[data-preview-drain]")) {
    void drain();
  }
});

paintScope();
void paintReaders();
setInterval(() => {
  paintScope();
  void paintReaders();
}, READERS_POLL_MS);
