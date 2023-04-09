
export function humanReadableDataSize(size: number | string | void) {

    const parsed = parseInt(size as any, 10);
    if (!parsed) {
        return `${size}`;
    }

    const i = Math.floor(Math.log(parsed) / Math.log(1024));
    const n = parsed / Math.pow(1024, i);
    return n.toFixed(2) + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

export function formatDateUTC(date: Date) {
    return `${date.getUTCFullYear()}${(date.getUTCMonth() + 1).toString().padStart(2, '0')}${date
        .getUTCDate()
        .toString()
        .padStart(2, '0')}`;
}
