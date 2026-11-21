import { spellAmount, spellNumberText } from './numbers';

type UnitWords = { one: string; many: string };

// Single-letter ambiguities such as "in" are deliberately absent: guessing a
// unit there is worse than leaving the word alone.
const UNITS: Record<string, UnitWords> = {
  kg: { one: 'kilogram', many: 'kilograms' },
  g: { one: 'gram', many: 'grams' },
  mg: { one: 'milligram', many: 'milligrams' },
  km: { one: 'kilometer', many: 'kilometers' },
  m: { one: 'meter', many: 'meters' },
  cm: { one: 'centimeter', many: 'centimeters' },
  mm: { one: 'millimeter', many: 'millimeters' },
  mi: { one: 'mile', many: 'miles' },
  ft: { one: 'foot', many: 'feet' },
  yd: { one: 'yard', many: 'yards' },
  lb: { one: 'pound', many: 'pounds' },
  oz: { one: 'ounce', many: 'ounces' },
  l: { one: 'liter', many: 'liters' },
  ml: { one: 'milliliter', many: 'milliliters' },
  s: { one: 'second', many: 'seconds' },
  ms: { one: 'millisecond', many: 'milliseconds' },
  min: { one: 'minute', many: 'minutes' },
  h: { one: 'hour', many: 'hours' },
  hr: { one: 'hour', many: 'hours' },
  ha: { one: 'hectare', many: 'hectares' },
  kb: { one: 'kilobyte', many: 'kilobytes' },
  mb: { one: 'megabyte', many: 'megabytes' },
  gb: { one: 'gigabyte', many: 'gigabytes' },
  tb: { one: 'terabyte', many: 'terabytes' },
  kw: { one: 'kilowatt', many: 'kilowatts' },
  hz: { one: 'hertz', many: 'hertz' },
  khz: { one: 'kilohertz', many: 'kilohertz' },
  mhz: { one: 'megahertz', many: 'megahertz' },
  ghz: { one: 'gigahertz', many: 'gigahertz' },
  pa: { one: 'pascal', many: 'pascals' },
  bar: { one: 'bar', many: 'bar' },
  cal: { one: 'calorie', many: 'calories' },
  kcal: { one: 'kilocalorie', many: 'kilocalories' },
  kj: { one: 'kilojoule', many: 'kilojoules' },
  bpm: { one: 'beat per minute', many: 'beats per minute' },
};

const CURRENCIES: Record<string, UnitWords> = {
  '€': { one: 'euro', many: 'euros' },
  '£': { one: 'pound', many: 'pounds' },
  '$': { one: 'dollar', many: 'dollars' },
  '¥': { one: 'yen', many: 'yen' },
};

const MAGNITUDES: Record<string, string> = {
  billion: 'billion',
  bn: 'billion',
  b: 'billion',
  million: 'million',
  m: 'million',
  thousand: 'thousand',
  k: 'thousand',
};

function isSingular(amount: string): boolean {
  return Number(amount.replaceAll(',', '')) === 1;
}

function powerPrefix(power: string): string {
  if (power === '²') return 'square ';
  if (power === '³') return 'cubic ';
  return '';
}

export function expandMoney(text: string): string {
  let out = text.replace(
    /([€£$¥])\s*(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|b|m|k)\b/gi,
    (match, symbol: string, amount: string, magnitudeText: string) => {
      const currency = CURRENCIES[symbol];
      const magnitude = MAGNITUDES[magnitudeText.toLowerCase()];
      if (currency === undefined || magnitude === undefined) return match;
      return `${spellAmount(amount)} ${magnitude} ${currency.many}`;
    },
  );

  out = out.replace(
    /([€£$¥])\s*(\d[\d,]*(?:\.\d+)?)/g,
    (match, symbol: string, amount: string) => {
      const currency = CURRENCIES[symbol];
      if (currency === undefined) return match;
      const clean = amount.replaceAll(',', '');
      const dot = clean.indexOf('.');
      if (dot === -1) {
        const wholeWord = spellNumberText(clean);
        if (wholeWord === null) return match;
        return `${wholeWord} ${Number(clean) === 1 ? currency.one : currency.many}`;
      }

      const wholeText = clean.slice(0, dot);
      const fractionText = clean.slice(dot + 1);
      if (fractionText.length > 2) {
        return `${spellAmount(clean)} ${currency.many}`;
      }

      const cents = Number(`${fractionText}00`.slice(0, 2));
      const whole = Number(wholeText === '' ? '0' : wholeText);
      const wholeWord = spellNumberText(wholeText === '' ? '0' : wholeText);
      if (wholeWord === null) return match;
      if (cents === 0) {
        return `${wholeWord} ${whole === 1 ? currency.one : currency.many}`;
      }

      const centsWord = spellNumberText(String(cents));
      if (centsWord === null) return match;
      const centsUnit = cents === 1 ? 'cent' : 'cents';
      if (whole === 0) return `${centsWord} ${centsUnit}`;
      return `${wholeWord} ${whole === 1 ? currency.one : currency.many} and ${centsWord} ${centsUnit}`;
    },
  );

  return out;
}

export function expandUnits(text: string): string {
  // Compound units come first so "kg/m²" is read as one expression rather
  // than as kilograms followed by a stray square metre.
  let out = text.replace(
    /(-?\d[\d,]*(?:\.\d+)?)\s*([a-z]{1,5})([²³]?)\s*\/\s*([a-z]{1,5})([²³]?)(?![a-z])/g,
    (match, amount: string, top: string, topPower: string, bottom: string, bottomPower: string) => {
      const topUnit = UNITS[top];
      const bottomUnit = UNITS[bottom];
      if (topUnit === undefined || bottomUnit === undefined) return match;
      const topWords = `${powerPrefix(topPower)}${isSingular(amount) ? topUnit.one : topUnit.many}`;
      const bottomWords = `${powerPrefix(bottomPower)}${bottomUnit.one}`;
      return `${spellAmount(amount)} ${topWords} per ${bottomWords}`;
    },
  );

  out = out.replace(
    /(-?\d[\d,]*(?:\.\d+)?)\s*°\s*([CF])\b/g,
    (_match, amount: string, scale: string) => {
      const degree = isSingular(amount) ? 'degree' : 'degrees';
      return `${spellAmount(amount)} ${degree} ${scale === 'F' ? 'Fahrenheit' : 'Celsius'}`;
    },
  );

  out = out.replace(
    /(-?\d[\d,]*(?:\.\d+)?)\s*°/g,
    (_match, amount: string) => `${spellAmount(amount)} ${isSingular(amount) ? 'degree' : 'degrees'}`,
  );

  out = out.replace(
    /(-?\d[\d,]*(?:\.\d+)?)\s*%/g,
    (_match, amount: string) => `${spellAmount(amount)} percent`,
  );

  out = out.replace(
    /(-?\d[\d,]*(?:\.\d+)?)\s*([a-z]{1,5})([²³])(?![a-z])/g,
    (match, amount: string, unitKey: string, power: string) => {
      const unit = UNITS[unitKey];
      if (unit === undefined) return match;
      const unitWord = isSingular(amount) ? unit.one : unit.many;
      return `${spellAmount(amount)} ${powerPrefix(power)}${unitWord}`;
    },
  );

  return out.replace(
    /(-?\d[\d,]*(?:\.\d+)?)\s*([a-z]{1,5})\b/g,
    (match, amount: string, unitKey: string) => {
      const unit = UNITS[unitKey];
      if (unit === undefined) return match;
      return `${spellAmount(amount)} ${isSingular(amount) ? unit.one : unit.many}`;
    },
  );
}
