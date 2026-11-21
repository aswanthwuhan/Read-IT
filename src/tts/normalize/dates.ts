import { spellNumberText, spellOrdinalText, spellYearText } from './numbers';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Tues: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Thur: 'Thursday',
  Thurs: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

function monthName(month: number): string | null {
  return month >= 1 && month <= 12 ? MONTHS[month - 1] : null;
}

function dayWords(day: number): string | null {
  return day >= 1 && day <= 31 ? spellOrdinalText(String(day)) : null;
}

function dateWords(month: number, day: number, year: string): string | null {
  const monthWord = monthName(month);
  const dayWord = dayWords(day);
  if (monthWord === null || dayWord === null) return null;
  return `${monthWord} ${dayWord}, ${spellYearText(year)}`;
}

function weekdayName(text: string): string {
  const key = `${text.charAt(0).toUpperCase()}${text.slice(1).toLowerCase()}`;
  return WEEKDAYS[key] ?? text;
}

function clockWords(hour: number, minute: string | undefined): string {
  const hourWord = spellNumberText(String(hour)) ?? String(hour);
  if (minute === undefined) return hourWord;
  const minuteValue = Number(minute);
  if (minuteValue === 0) return `${hourWord} o'clock`;
  if (minuteValue < 10) return `${hourWord} oh ${spellNumberText(minute) ?? minute}`;
  return `${hourWord} ${spellNumberText(minute) ?? minute}`;
}

export function expandIsoDates(text: string): string {
  return text.replace(
    /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
    (match, year: string, month: string, day: string) => {
      const words = dateWords(Number(month), Number(day), year);
      return words ?? match;
    },
  );
}

export function expandSlashDates(text: string): string {
  return text.replace(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g,
    (match, firstText: string, secondText: string, year: string) => {
      const first = Number(firstText);
      const second = Number(secondText);
      // "3/5/24" reads month-first; "13/5/24" can only be day-first.
      const month = first <= 12 ? first : second;
      const day = first <= 12 ? second : first;
      const words = dateWords(month, day, year);
      return words ?? match;
    },
  );
}

export function expandWeekdays(text: string): string {
  // Case-sensitive on purpose: "sun" is a thing, "Sun" is the abbreviation.
  // The lookahead keeps "Monday", "Sunday" and similar full names intact.
  return text.replace(
    /\b(Tues|Thurs|Thur|Mon|Tue|Wed|Thu|Fri|Sat|Sun)(\.?)(?![A-Za-z0-9_])/g,
    (_match, day: string, period: string) => `${weekdayName(day)}${period}`,
  );
}

export function expandTimes(text: string): string {
  let out = text.replace(
    /\b(Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b\.?\s+(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?\b/gi,
    (match, day: string, hourText: string, minute: string | undefined, half: string) => {
      const hour = Number(hourText);
      if (hour < 1 || hour > 12) return match;
      return `${weekdayName(day)} ${clockWords(hour, minute)} ${half.toUpperCase()} M`;
    },
  );

  out = out.replace(
    /\b(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?\b/gi,
    (match, hourText: string, minute: string | undefined, half: string) => {
      const hour = Number(hourText);
      if (hour < 1 || hour > 12) return match;
      return `${clockWords(hour, minute)} ${half.toUpperCase()} M`;
    },
  );

  return out.replace(
    /\b(\d{1,2}):([0-5]\d)\b/g,
    (match, hourText: string, minute: string) => {
      const hour = Number(hourText);
      return hour > 23 ? match : clockWords(hour, minute);
    },
  );
}

export function expandQuarters(text: string): string {
  let out = text.replace(
    /\bFY\s*(\d{2,4})\b/gi,
    (_match, year: string) => `fiscal year ${spellYearText(year)}`,
  );

  out = out.replace(
    /\b([1-4])H\s*(\d{2,4})\b/gi,
    (_match, half: string, year: string) => `${spellOrdinalText(half) ?? half} half of ${spellYearText(year)}`,
  );

  return out.replace(
    /\bQ([1-4])\b/g,
    (_match, quarter: string) => `${spellOrdinalText(quarter) ?? quarter} quarter`,
  );
}
