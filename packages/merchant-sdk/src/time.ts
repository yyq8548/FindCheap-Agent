const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** Strict RFC3339 calendar validation. Returns epoch milliseconds or undefined. */
export function parseRfc3339Timestamp(value: string): number | undefined {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return undefined;

  const [, year, month, day, hour, minute, second, , , offsetHour, offsetMinute] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericHour = Number(hour);
  const numericMinute = Number(minute);
  const numericSecond = Number(second);
  const numericOffsetHour = offsetHour === undefined ? 0 : Number(offsetHour);
  const numericOffsetMinute = offsetMinute === undefined ? 0 : Number(offsetMinute);
  const isLeapYear =
    numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const monthLength = daysInMonth[numericMonth - 1];

  if (
    numericMonth < 1 ||
    numericMonth > 12 ||
    monthLength === undefined ||
    numericDay < 1 ||
    numericDay > monthLength ||
    numericHour > 23 ||
    numericMinute > 59 ||
    numericSecond > 59 ||
    numericOffsetHour > 23 ||
    numericOffsetMinute > 59
  ) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
