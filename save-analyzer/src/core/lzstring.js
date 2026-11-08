// LZ-String 1.x compatible implementation (MIT algorithm by pieroxy).
// RPG Maker MV (.rpgsave) and SugarCube/Twine exports use compressToBase64.
// Verified against the reference package in test/lzstring.test.mjs.

const KEY_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const KEY_URI = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
const reverse = {};
function charIndex(alphabet, ch) {
  if (!reverse[alphabet]) {
    reverse[alphabet] = {};
    for (let i = 0; i < alphabet.length; i++) reverse[alphabet][alphabet.charAt(i)] = i;
  }
  return reverse[alphabet][ch];
}

function _compress(uncompressed, bitsPerChar, getCharFromInt) {
  if (uncompressed == null) return '';
  const dictionary = new Map();
  const dictionaryToCreate = new Set();
  let wc;
  let w = '';
  let enlargeIn = 2;
  let dictSize = 3;
  let numBits = 2;
  const data = [];
  let dataVal = 0;
  let dataPosition = 0;

  const writeBit = (bit) => {
    dataVal = (dataVal << 1) | bit;
    if (dataPosition === bitsPerChar - 1) {
      dataPosition = 0;
      data.push(getCharFromInt(dataVal));
      dataVal = 0;
    } else dataPosition++;
  };
  const writeBits = (count, value) => {
    for (let i = 0; i < count; i++) {
      writeBit(value & 1);
      value >>= 1;
    }
  };
  const emitW = () => {
    if (dictionaryToCreate.has(w)) {
      const code = w.charCodeAt(0);
      if (code < 256) {
        writeBits(numBits, 0);
        writeBits(8, code);
      } else {
        writeBits(numBits, 1);
        writeBits(16, code);
      }
      enlargeIn--;
      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
      dictionaryToCreate.delete(w);
    } else {
      writeBits(numBits, dictionary.get(w));
    }
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  };

  for (let ii = 0; ii < uncompressed.length; ii++) {
    const c = uncompressed.charAt(ii);
    if (!dictionary.has(c)) {
      dictionary.set(c, dictSize++);
      dictionaryToCreate.add(c);
    }
    wc = w + c;
    if (dictionary.has(wc)) {
      w = wc;
    } else {
      emitW();
      dictionary.set(wc, dictSize++);
      w = String(c);
    }
  }
  if (w !== '') emitW();
  writeBits(numBits, 2);
  for (;;) {
    dataVal <<= 1;
    if (dataPosition === bitsPerChar - 1) {
      data.push(getCharFromInt(dataVal));
      break;
    } else dataPosition++;
  }
  return data.join('');
}

function _decompress(length, resetValue, getNextValue) {
  const dictionary = [0, 1, 2];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = '';
  const result = [];
  let w;
  let c;
  const data = { val: getNextValue(0), position: resetValue, index: 1 };

  const readBits = (count) => {
    let bits = 0;
    let power = 1;
    const maxpower = Math.pow(2, count);
    while (power !== maxpower) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return bits;
  };

  switch (readBits(2)) {
    case 0:
      c = String.fromCharCode(readBits(8));
      break;
    case 1:
      c = String.fromCharCode(readBits(16));
      break;
    case 2:
      return '';
    default:
      return null;
  }
  dictionary[3] = c;
  w = c;
  result.push(c);
  for (;;) {
    if (data.index > length) return '';
    let cc = readBits(numBits);
    switch (cc) {
      case 0:
        dictionary[dictSize++] = String.fromCharCode(readBits(8));
        cc = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dictionary[dictSize++] = String.fromCharCode(readBits(16));
        cc = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join('');
      default:
        break;
    }
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
    if (dictionary[cc]) entry = dictionary[cc];
    else if (cc === dictSize) entry = w + w.charAt(0);
    else return null;
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  }
}

export function compressToBase64(input) {
  if (input == null) return '';
  const res = _compress(input, 6, (a) => KEY_B64.charAt(a));
  switch (res.length % 4) {
    case 1:
      return res + '===';
    case 2:
      return res + '==';
    case 3:
      return res + '=';
    default:
      return res;
  }
}

export function decompressFromBase64(input) {
  if (input == null) return '';
  if (input === '') return null;
  return _decompress(input.length, 32, (index) => charIndex(KEY_B64, input.charAt(index)));
}

export function compressToUTF16(input) {
  if (input == null) return '';
  return _compress(input, 15, (a) => String.fromCharCode(a + 32)) + ' ';
}

export function decompressFromUTF16(input) {
  if (input == null) return '';
  if (input === '') return null;
  return _decompress(input.length, 16384, (index) => input.charCodeAt(index) - 32);
}

export function compressToEncodedURIComponent(input) {
  if (input == null) return '';
  return _compress(input, 6, (a) => KEY_URI.charAt(a));
}

export function decompressFromEncodedURIComponent(input) {
  if (input == null) return '';
  if (input === '') return null;
  const clean = input.replace(/ /g, '+');
  return _decompress(clean.length, 32, (index) => charIndex(KEY_URI, clean.charAt(index)));
}

export function compress(input) {
  return _compress(input, 16, (a) => String.fromCharCode(a));
}

export function decompress(compressed) {
  if (compressed == null) return '';
  if (compressed === '') return null;
  return _decompress(compressed.length, 32768, (index) => compressed.charCodeAt(index));
}

/** Safe wrapper: never throws, returns null for invalid input. */
export function tryDecompress(fn, input) {
  try {
    const out = fn(input);
    return typeof out === 'string' && out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
