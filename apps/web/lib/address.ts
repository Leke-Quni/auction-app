const PARTS = ["name", "line1", "line2", "city", "postcode", "country", "phone"] as const;

/** Reads an address typed into fields named `${prefix}name`, `${prefix}line1`, ...; empty parts are left out. Null if all are empty. */
export function readAddress(formData: FormData, prefix = ""): Record<string, string> | null {
  const address: Record<string, string> = {};
  for (const part of PARTS) {
    const value = String(formData.get(`${prefix}${part}`) ?? "").trim();
    if (value) address[part] = value;
  }
  return Object.keys(address).length > 0 ? address : null;
}
