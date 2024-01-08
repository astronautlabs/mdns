import { ValidationError } from "./ValidationError";

function isNumeric(value) {
  return !Number.isNaN(parseFloat(value)) && Number.isFinite(value);
}

/**
 * Validates a transport protocol, throws err on invalid input
 * @param {string} str
 */
export function protocol(str) {
  if (typeof str !== 'string') {
    throw new ValidationError(`Protocol must be a string, got ${typeof str}`);
  }

  if (str === '' || (str !== '_tcp' && str !== '_udp')) {
    throw new ValidationError(`Protocol must be _tcp or _udp, got '${str}'`);
  }
};

/**
 * Validates a service name, throws err on invalid input
 * @param {string} str
 */
export function serviceName(str) {
  if (typeof str !== 'string') {
    throw new ValidationError(
      `Service name must be a string, got ${typeof str}`);
  }

  if (!str) {
    throw new ValidationError("Service name can't be an empty string");
  }

  if (!/^_/.test(str)) {
    throw new ValidationError(`Service '${str}' must start with '_'`);
  }

  // 15 bytes not including the leading underscore
  if (Buffer.byteLength(str) > 16) {
    // throw new ValidationError("Service '%s' is > 15 bytes", str);
    console.log(`Service '${str}' is > 15 bytes`);
  }

  if (!/^_[A-Za-z0-9]/.test(str) || !/[A-Za-z0-9]*$/.test(str)) {
    throw new ValidationError(
      `Service '${str}' must start and end with a letter or digit`);
  }

  if (!/^_[A-Za-z0-9-]+$/.test(str)) {
    throw new ValidationError(
      `Service '${str}' should be only letters, digits, and hyphens`);
  }

  if (/--/.test(str)) {
    throw new ValidationError(
      `Service '${str}' must not have consecutive hyphens`);
  }

  if (!/[A-Za-z]/.test(str)) {
    throw new ValidationError(`Service '${str}' must have at least 1 letter`);
  }
};

/**
 * Validates a dns label, throws err on invalid input
 *
 * @param {string} str - label to validate
 * @param {string} [name] - name of the label (for better error messages)
 */
export function label(str: string, name = 'label') {
  if (typeof str !== 'string') {
    throw new ValidationError(
      `${name} name must be a string, got ${typeof str}`);
  }

  if (!str) {
    throw new ValidationError(`${name} name can't be an empty string`);
  }

  if (/[\x00-\x1F]|\x7F/.test(str)) {
    throw new ValidationError(
      `${name} name '${str}' can't contain control chars`);
  }

  if (Buffer.byteLength(str) > 63) {
    throw new ValidationError(
      `${name} must be <= 63 bytes. ${str} is ${Buffer.byteLength(str)}`);
  }
};

/**
 * Validates a port, throws err on invalid input
 *
 * @param {number} num
 */
export function port(num) {
  if (!Number.isInteger(num) || num <= 0 || num > 0xFFFF) {
    throw new ValidationError(
      'Port must be an integer between 0 and 65535, got %s', num);
  }
};

/**
 * Validates rdata for a TXT record, throws err on invalid input
 *
 * Example of a valid txt object:
 * {
 *   key: 'value',
 *   buf: Buffer.alloc(123)
 * }
 *
 * @param {object} obj
 */
export function txt(obj) {
  let sizeTotal = 0;
  const keys = new Set();

  if (typeof obj !== 'object') {
    throw new ValidationError('TXT must be an object');
  }

  // validate each key value pair
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    let size = Buffer.byteLength(key);

    // keys
    if (Buffer.byteLength(key) > 9) {
      throw new ValidationError(`Key '${key}' in TXT is > 9 chars`);
    }

    if (!!~key.indexOf('=')) {
      throw new ValidationError(`Key '${key}' in TXT contains a '='`);
    }

    if (!/^[ -~]*$/.test(key)) {
      throw new ValidationError(`Key '${key}' in TXT is not printable ascii`);
    }

    if (keys.has(key.toLowerCase())) {
      throw new ValidationError(
        `Key '${key}' in TXT occurs more than once. (case insensitive)`);
    }

    keys.add(key.toLowerCase());

    // value type
    if (
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !isNumeric(value) &&
      !Buffer.isBuffer(value)
    ) {
      throw new ValidationError(
        `TXT values must be a string, buffer, number, or boolean. got ${typeof value}`);
    }

    // size limits
    if (typeof value !== 'boolean') {
      size += (Buffer.isBuffer(value))
        ? value.length
        : Buffer.byteLength(value.toString());

      // add 1 for the '=' in 'key=value'
      // add 1 for the length byte to be written before 'key=value'
      size += 2;
    }

    sizeTotal += size;

    if (size > 255) {
      throw new ValidationError('Each key/value in TXT must be < 255 bytes');
    }

    if (sizeTotal > 1300) {
      throw new ValidationError('TXT record is > 1300 bytes.');
    }
  });
};
