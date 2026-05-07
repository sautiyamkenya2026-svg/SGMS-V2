export function toLocalDateValue(input: Date | string | number = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function toLocalMonthValue(input: Date | string | number = new Date()) {
  return toLocalDateValue(input).slice(0, 7);
}

export function toDateValue(value: string | null | undefined) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : toLocalDateValue(value);
}

export function getMonthBounds(monthValue: string) {
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  return {
    start: toLocalDateValue(start),
    end: toLocalDateValue(end),
    daysInMonth: end.getDate(),
  };
}

export function listMonthDays(monthValue: string) {
  const { start, daysInMonth } = getMonthBounds(monthValue);
  const [yearText, monthText] = start.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  return Array.from({ length: daysInMonth }, (_, index) =>
    toLocalDateValue(new Date(year, monthIndex, index + 1)),
  );
}
