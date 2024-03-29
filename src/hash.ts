/**
 * Deterministic JSON.stringify for resource record stuff
 *
 * Object keys are sorted so strings are always the same independent of
 * what order properties were added in. Strings are lowercased because
 * record names, TXT keys, SRV target names, etc. need to be compared
 * case-insensitively.
 *
 * @param  {*} val
 * @return {string}
 */
function stringify(val) {
  if (typeof val === 'string') return JSON.stringify(val.toLowerCase());

  if (Array.isArray(val)) return `[${val.map(stringify)}]`;

  if (typeof val === 'object' && `${val}` === '[object Object]') {
    const str = Object.keys(val)
      .sort()
      .map(key => stringify(key) + ':' + stringify(val[key]))
      .join(',');

    return `{${str}}`;
  }

  return JSON.stringify(val);
}

/**
 * djb2 string hashing function
 *
 * @param  {string} str
 * @return {string} - 32b unsigned hex
 */
function djb2(str) {
  let hash = 5381;
  let i = str.length;

  // hash stays signed 32b with XOR operator
  while (i) hash = (hash * 33) ^ str.charCodeAt(--i);

  // coerce to unsigned to get strings without -'s
  return (hash >>> 0).toString(16);
}

/**
 * Takes any number of parameters and makes a string hash of them.
 * @return {...*} arguments
 */
export function hash(...args) {
  return djb2(stringify(args));
};

hash.stringify = stringify;