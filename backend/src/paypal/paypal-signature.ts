import * as crypto from 'crypto';
import crc32 from 'buffer-crc32';

const certCache = new Map<string, string>();

// Reject cert URLs that don't belong to PayPal — otherwise an attacker
const TRUSTED_CERT_HOST = /(^|\.)paypal\.com$/;

async function getCert(url: string): Promise<string> {
  const host = new URL(url).hostname;
  if (!TRUSTED_CERT_HOST.test(host)) {
    throw new Error(`Refusing to fetch cert from untrusted host: ${host}`);
  }
  if (!certCache.has(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download PayPal cert: ${res.status}`);
    certCache.set(url, await res.text());
  }
  return certCache.get(url)!;
}

// Self-cryptographic verification to avoids round trip to POST /v1/notifications/verify-webhook-signature
// include a CRC32 checksum of the raw Body the RSA-SHA256-signed string.

export async function verifyPayPalSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  webhookId: string,
): Promise<boolean> {
  const transmissionId = headers['paypal-transmission-id'] as string;
  const transmissionTime = headers['paypal-transmission-time'] as string;
  const certUrl = headers['paypal-cert-url'] as string;
  const transmissionSig = headers['paypal-transmission-sig'] as string;

  if (!transmissionId || !transmissionTime || !certUrl || !transmissionSig) {
    return false;
  }

  const checksum = crc32.unsigned(rawBody);
  const message = `${transmissionId}|${transmissionTime}|${webhookId}|${checksum}`;

  const cert = await getCert(certUrl);
  const verifier = crypto.createVerify('SHA256');
  verifier.update(message);
  return verifier.verify(cert, transmissionSig, 'base64');
}
