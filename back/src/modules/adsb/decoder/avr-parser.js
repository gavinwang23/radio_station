/**
 * Incremental dump1090 AVR framing. Metadata is validated then discarded;
 * reception time (not the receiver's wrapping 12 MHz clock) drives tracking.
 * Format reference: flightaware/dump1090 net_io.c decodeHexMessage.
 */
export class AvrParser {
  #candidate = '';
  #limit;
  #onFrame;
  #onInvalid;

  constructor({ onFrame = () => {}, onInvalid = () => {}, maxBufferBytes = 65536 } = {}) {
    if (typeof onFrame !== 'function' || typeof onInvalid !== 'function') throw new TypeError('AVR callbacks must be functions');
    if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 1) throw new RangeError('maxBufferBytes must be a positive integer');
    // Longest supported candidate: '<' + timestamp(12) + signal(2) + data(28).
    this.#limit = Math.min(maxBufferBytes, 43);
    this.#onFrame = onFrame;
    this.#onInvalid = onInvalid;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') throw new TypeError('AVR input must be a Buffer or string');
    // latin1 preserves non-ASCII bytes so noise cannot become valid hex by
    // masking its high bit. The candidate alone is retained between pushes.
    const text = Buffer.isBuffer(chunk) ? chunk.toString('latin1') : chunk;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '*' || ch === '@' || ch === '%' || ch === '<') {
        if (this.#candidate) this.#onInvalid('incomplete-frame');
        this.#candidate = ch;
        continue;
      }
      if (!this.#candidate) continue;
      if (ch === ';') {
        const candidate = this.#candidate;
        this.#candidate = '';
        const prefixLength = candidate[0] === '*' ? 1 : candidate[0] === '<' ? 15 : 13;
        const data = candidate.slice(prefixLength);
        if (candidate.length < prefixLength || (data.length !== 14 && data.length !== 28)) {
          // The real dump1090 raw idle heartbeat is a Mode A/C-sized zero frame.
          if (candidate !== '*0000') this.#onInvalid('invalid-length');
        } else {
          this.#onFrame(data.toUpperCase());
        }
      } else if (!isHex(ch)) {
        this.#candidate = '';
        this.#onInvalid('invalid-hex');
      } else if (this.#candidate.length >= this.#limit) {
        this.#candidate = '';
        this.#onInvalid('frame-too-long');
      } else {
        this.#candidate += ch;
      }
    }
  }

  reset() { this.#candidate = ''; }
}

function isHex(ch) {
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}
