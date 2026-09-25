// @ts-check

/**
 * The photo control, the product's half of the seam. `design/scripts/file-field.js` is the control;
 * this hands it the upload route as its transfer and keeps what the form posts in step with what
 * the field holds. Everything a field needs to know arrives on the markup the server drew
 * (`src/presentation/controls/file-control.ts`): where to send a file, the cap, and the clear.
 */

import {
  FILE_FIELD_CHANGE,
  FILE_FIELD_HOOKS,
  FileRefusal,
  mountFileFields,
  settleFileFields,
  uploadingIn,
} from "../design/scripts/file-field.js";
import { watchArrivals } from "./dom-arrivals.js";
import { registerRegionRelease } from "./region-scope.js";
import { FILE_NAME_HEADER, onCreateFinished, FILE_FIELD_ATTRIBUTES as WIRE } from "./shell-dom.js";

/**
 * @typedef {import("../design/scripts/file-field.js").Held} Held
 * @typedef {import("../design/scripts/file-field.js").Picked} Picked
 * @typedef {import("../design/scripts/file-field.js").Transfer} Transfer
 * @typedef {import("../design/scripts/file-field.js").Upload} Upload
 * @typedef {import("../design/scripts/file-field.js").FileFieldChange} FileFieldChange
 * @typedef {{ cap: number, oversize: string }} Limits
 * @typedef {{ held: Held, key: string }} Admitted
 * @typedef {Pick<XMLHttpRequest, "open" | "setRequestHeader" | "send" | "abort"
 *   | "addEventListener" | "status" | "responseText"> & {
 *   upload: Pick<XMLHttpRequestUpload, "addEventListener">,
 * }} UploadRequest
 */

const FIELD = `[${FILE_FIELD_HOOKS.field}]`;
const VALUE = `[${WIRE.value}]`;
const HELD_SAVE = `[${FILE_FIELD_HOOKS.save}]`;

/** The key the route answered each admitted file with, by the file as the field holds it. */
const KEYS = new WeakMap();

/** @param {Held} held @returns {string | undefined} */
export const admittedKey = (held) => KEYS.get(held);

/**
 * What a field posts for what it holds now: the key an upload answered a file it took with, the
 * key it was drawn with while it holds that file still, and once it holds nothing, the clear if it
 * was drawn holding a file and nothing if it was not. Every file but the drawn one came by upload.
 *
 * @param {Held | null} current
 * @param {{ held: string, clear: string }} drawn
 */
export function postedValue(current, drawn) {
  if (current === null) return drawn.held === "" ? "" : drawn.clear;
  return admittedKey(current) ?? drawn.held;
}

/** @param {string} body @returns {Record<string, unknown>} */
function parsed(body) {
  try {
    const value = JSON.parse(body);
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}

/**
 * What the upload route's answer means for the field: the file it admitted, or a refusal carrying
 * the sentence to say. A 413 is the writing-route guard's or Bun's and carries no sentence, so the
 * field says the size sentence the server drew for it. Anything else is a failure of ours.
 *
 * @param {number} status
 * @param {string} body
 * @param {Limits} limits
 * @returns {Admitted}
 */
export function settleUpload(status, body, limits) {
  const answer = parsed(body);
  const admitted = status === 201 ? admittedFrom(answer) : undefined;
  if (admitted) return admitted;
  const sentence = sentenceIn(answer);
  const { refusal } = answer;
  if ((status === 409 || status === 415) && typeof refusal === "string" && sentence) {
    throw new FileRefusal(refusal, sentence);
  }
  if (status === 413) {
    throw new FileRefusal("too_large", limits.oversize);
  }
  throw new Error(`The upload failed with status ${status}.`);
}

/** @param {Record<string, unknown>} answer @returns {Admitted | undefined} */
function admittedFrom({ key, url, name, size }) {
  const named = typeof key === "string" && typeof url === "string" && typeof name === "string";
  return named && Number.isSafeInteger(size)
    ? { held: { name, size: /** @type {number} */ (size), url }, key }
    : undefined;
}

/** @param {Record<string, unknown>} answer */
function sentenceIn({ message }) {
  return typeof message === "string" && message !== "" ? message : undefined;
}

/**
 * The cap and its sentence as the server drew them. A field missing either is a rendering bug,
 * said rather than guessed around: a guessed cap would refuse files the server takes.
 *
 * @param {HTMLElement} host
 * @returns {Limits}
 */
function limitsOf(host) {
  const cap = Number(host.getAttribute(WIRE.cap));
  const oversize = host.getAttribute(WIRE.oversize) ?? "";
  if (!Number.isSafeInteger(cap) || cap <= 0 || oversize === "") {
    throw new Error(`The file field "${host.id}" carries no cap to hold its files to.`);
  }
  return { cap, oversize };
}

/**
 * Send one pick to the field's upload address. A file over the cap is refused before a byte
 * leaves, and whatever takes the field off the page takes its upload with it.
 *
 * @param {() => UploadRequest} open
 * @returns {Transfer}
 */
export function uploadTransfer(open) {
  return (picked, _kind, onProgress, host) => {
    const limits = limitsOf(host);
    const address = host.getAttribute(WIRE.upload);
    if (picked.size > limits.cap) {
      return {
        done: Promise.reject(new FileRefusal("too_large", limits.oversize)),
        abort() {},
      };
    }
    if (!address || !picked.file) {
      return {
        done: Promise.reject(new Error("The field has nowhere to send a file.")),
        abort() {},
      };
    }
    const request = open();
    /** @type {Promise<Held>} */
    const done = new Promise((resolve, reject) => {
      const settle = () => {
        try {
          const admitted = settleUpload(request.status, request.responseText, limits);
          KEYS.set(admitted.held, admitted.key);
          resolve(admitted.held);
        } catch (error) {
          reject(error);
        }
      };
      request.addEventListener("load", settle);
      request.addEventListener("error", settle);
      request.addEventListener("abort", () =>
        reject(new DOMException("The upload was stopped.", "AbortError")),
      );
    });
    request.upload.addEventListener("progress", (event) => onProgress(event.loaded));
    request.open("POST", address);
    request.setRequestHeader(FILE_NAME_HEADER, encodeURIComponent(picked.name.toWellFormed()));
    if (picked.type !== "") request.setRequestHeader("Content-Type", picked.type);
    request.send(picked.file);
    const release = registerRegionRelease(host, "file upload", () => request.abort());
    done.then(release, release);
    return { done, abort: () => request.abort() };
  };
}

/** @param {Event} event */
function keepValueInStep(event) {
  const host = event.target;
  if (!(host instanceof HTMLElement)) return;
  const input = host.querySelector(VALUE);
  if (!(input instanceof HTMLInputElement)) return;
  const change = /** @type {CustomEvent<FileFieldChange>} */ (event).detail;
  const drawn = {
    held: input.getAttribute(WIRE.heldKey) ?? "",
    clear: input.getAttribute(WIRE.clearValue) ?? "",
  };
  input.value = postedValue(change.current, drawn);
}

/**
 * The fields' listeners, apart from their mounting so the rules run in Bun: their value kept in
 * step, put back when a create finishes or is put down, and a form refusing to send while a file
 * is travelling, which moves the person to the save that says what it waits on.
 *
 * @param {Pick<Document, "addEventListener">} root
 * @param {typeof settleFileFields} settle
 */
export function wireFileFields(root, settle = settleFileFields) {
  root.addEventListener(FILE_FIELD_CHANGE, keepValueInStep);
  onCreateFinished(root, (form) => settle(form, "revert"));
  root.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !uploadingIn(form)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const save = form.querySelector(HELD_SAVE);
      if (save instanceof HTMLElement) save.focus({ focusVisible: true });
    },
    true,
  );
}

/** @param {Document | Element} node @returns {Element[]} */
const hostsIn = (node) => [
  ...(node instanceof Element && node.matches(FIELD) ? [node] : []),
  ...node.querySelectorAll(FIELD),
];

/**
 * Mount what arrived, once per batch. A field the server drew without its cap says so after every
 * field beside it has its control.
 *
 * @param {readonly (Document | Element)[]} nodes
 * @param {Transfer} transfer
 */
function mountArrivals(nodes, transfer) {
  /** @type {unknown[]} */
  const refusals = [];
  for (const host of nodes.flatMap(hostsIn)) {
    if (!(host instanceof HTMLElement) || !host.parentElement) continue;
    try {
      limitsOf(host);
    } catch (error) {
      refusals.push(error);
    }
    mountFileFields(host.parentElement, transfer);
  }
  if (refusals.length > 0) throw refusals[0];
}

/** @param {Document} root */
export function startFileFields(root) {
  const transfer = uploadTransfer(() => new XMLHttpRequest());
  wireFileFields(root);
  watchArrivals(root, (nodes) => mountArrivals(nodes, transfer));
  mountArrivals([root], transfer);
}

if (typeof document !== "undefined") startFileFields(document);
