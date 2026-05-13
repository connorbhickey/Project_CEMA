const SSN_RE = /\b(\d{3})[-\s]?(\d{2})[-\s]?(\d{4})\b/g;

export function maskSsn(ssn: string): string {
  if (ssn.length === 11 && ssn[3] === '-' && ssn[6] === '-') {
    return `***-**-${ssn.slice(7)}`;
  }
  if (ssn.length === 9) {
    return `*****${ssn.slice(5)}`;
  }
  return ssn.replace(SSN_RE, '***-**-$3');
}

export function redactPii<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return value.replace(SSN_RE, '***-**-$3') as unknown as T;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => redactPii(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.toLowerCase() === 'ssn' && typeof v === 'string') {
        out[k] = maskSsn(v);
      } else {
        out[k] = redactPii(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}
