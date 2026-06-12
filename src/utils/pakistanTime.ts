const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type PakistanDateParts = {
    year: number;
    monthIndex: number;
    date: number;
    day: number;
};

const toPakistanShiftedDate = (value: Date) => new Date(value.getTime() + PKT_OFFSET_MS);

export const getPakistanDateParts = (value = new Date()): PakistanDateParts => {
    const shifted = toPakistanShiftedDate(value);
    return {
        year: shifted.getUTCFullYear(),
        monthIndex: shifted.getUTCMonth(),
        date: shifted.getUTCDate(),
        day: shifted.getUTCDay(),
    };
};

export const fromPakistanDateParts = (
    year: number,
    monthIndex: number,
    date: number,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0
) => new Date(Date.UTC(year, monthIndex, date, hour, minute, second, millisecond) - PKT_OFFSET_MS);

export const startOfPakistanDay = (value = new Date()) => {
    const parts = getPakistanDateParts(value);
    return fromPakistanDateParts(parts.year, parts.monthIndex, parts.date);
};

export const addPakistanDays = (value: Date, days: number) =>
    new Date(value.getTime() + days * DAY_MS);

export const startOfPakistanWeek = (value = new Date()) => {
    const dayStart = startOfPakistanDay(value);
    const day = getPakistanDateParts(value).day;
    const daysSinceMonday = (day + 6) % 7;
    return addPakistanDays(dayStart, -daysSinceMonday);
};

export const startOfPakistanMonth = (value = new Date()) => {
    const parts = getPakistanDateParts(value);
    return fromPakistanDateParts(parts.year, parts.monthIndex, 1);
};

export const addPakistanMonths = (value: Date, months: number) => {
    const parts = getPakistanDateParts(value);
    return fromPakistanDateParts(parts.year, parts.monthIndex + months, parts.date);
};

const pad = (value: number) => String(value).padStart(2, '0');

export const formatPakistanDayKey = (value: Date) => {
    const parts = getPakistanDateParts(value);
    return `${parts.year}-${pad(parts.monthIndex + 1)}-${pad(parts.date)}`;
};

export const formatPakistanMonthKey = (value: Date) => {
    const parts = getPakistanDateParts(value);
    return `${parts.year}-${pad(parts.monthIndex + 1)}`;
};

export const formatPakistanDayLabel = (value: Date) =>
    new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Karachi' }).format(value);

export const formatPakistanShortDateLabel = (value: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Karachi' }).format(value);

export const formatPakistanMonthLabel = (value: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'Asia/Karachi' }).format(value);
