// A query parameter given more than once (`?q=a&q=b`) arrives as a list; the pages use the first.
export const firstParam = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";

export const ownKey = <T extends object>(record: T, key: string): key is Extract<keyof T, string> => Object.hasOwn(record, key);
