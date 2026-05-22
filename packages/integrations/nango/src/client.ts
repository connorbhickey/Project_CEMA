import { Nango } from '@nangohq/node';

let _nango: Nango | null = null;

export function getNango(): Nango {
  if (!_nango) {
    const secretKey = process.env.NANGO_SECRET_KEY;
    if (!secretKey) {
      throw new Error('NANGO_SECRET_KEY environment variable is required');
    }
    _nango = new Nango({ secretKey });
  }
  return _nango;
}
