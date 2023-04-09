
import { cpus } from 'os';

export const ONE_WEEK_MILLISECONDS = 1000 * 3600 * 24 * 7;
export const ONE_MONTH_MILLISECONDS = 1000 * 3600 * 24 * 30;
export const ONE_DECADE_MILLISECONDS = 1000 * 3600 * 24 * 365 * 10;

export const SYSTEM_CPU_COUNT = cpus().length;
