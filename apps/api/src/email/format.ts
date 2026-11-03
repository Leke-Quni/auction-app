export const utc = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
