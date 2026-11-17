/**
 * Expected altitude text as the ADS-B views render it: `toLocaleString()` follows the browser locale,
 * so tests must derive the separator instead of assuming en-US grouping.
 */
export const feet = (value: number): string => `${value.toLocaleString()} ft`;
