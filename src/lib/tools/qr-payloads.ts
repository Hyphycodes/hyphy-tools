/*
 * What a QR code says, in the formats phone cameras understand. Pure and tested: a wrong
 * character here is a code that opens nothing.
 */

import { wifiPayload } from './qr';

export { parseWifi, wifiPayload, type WifiDetails } from './qr';

export type QrContent =
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'wifi';
      ssid: string;
      password: string;
      security: 'WPA' | 'WEP' | 'nopass';
      hidden: boolean;
    }
  | { kind: 'contact'; contact: Contact }
  | { kind: 'phone'; number: string }
  | { kind: 'sms'; number: string; message: string }
  | { kind: 'email'; to: string; subject: string; body: string };

export type QrKind = QrContent['kind'];

export type Contact = {
  first: string;
  last: string;
  org: string;
  title: string;
  phone: string;
  email: string;
  url: string;
  note: string;
};

export const emptyContact: Contact = {
  first: '',
  last: '',
  org: '',
  title: '',
  phone: '',
  email: '',
  url: '',
  note: '',
};

/** "hyphy.example/menu" → "https://hyphy.example/menu"; anything else untouched. */
export function normalizeLink(input: string) {
  const text = input.trim();
  if (!text) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(text)) return `https://${text}`;
  return text;
}

/** A link a phone will open as a web page: http or https with a real host. */
export function isWebLink(input: string) {
  try {
    const url = new URL(normalizeLink(input));
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Phone numbers keep digits and one leading "+". */
export function cleanPhone(input: string) {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return digits ? `${trimmed.startsWith('+') ? '+' : ''}${digits}` : '';
}

/** vCard text values escape backslashes, commas, semicolons and line breaks. */
function vcardText(value: string) {
  return value
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function vcard(contact: Contact) {
  const name = [contact.first, contact.last]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vcardText(contact.last)};${vcardText(contact.first)};;;`,
    `FN:${vcardText(name || contact.org)}`,
    contact.org.trim() && `ORG:${vcardText(contact.org)}`,
    contact.title.trim() && `TITLE:${vcardText(contact.title)}`,
    cleanPhone(contact.phone) && `TEL;TYPE=CELL:${cleanPhone(contact.phone)}`,
    contact.email.trim() && `EMAIL:${vcardText(contact.email)}`,
    contact.url.trim() && `URL:${vcardText(normalizeLink(contact.url))}`,
    contact.note.trim() && `NOTE:${vcardText(contact.note)}`,
    'END:VCARD',
  ].filter(Boolean);
  return lines.join('\r\n');
}

/** SMSTO is the form camera apps and scanners agree on: number, then the message. */
export function smsPayload(number: string, message: string) {
  const to = cleanPhone(number);
  if (!to) return '';
  return `SMSTO:${to}:${message.trim()}`;
}

export function mailtoPayload(to: string, subject: string, body: string) {
  const address = to.trim();
  if (!address) return '';
  const query = [
    subject.trim() && `subject=${encodeURIComponent(subject.trim())}`,
    body.trim() && `body=${encodeURIComponent(body.trim())}`,
  ]
    .filter(Boolean)
    .join('&');
  return `mailto:${address}${query ? `?${query}` : ''}`;
}

/** The text inside the code, or '' when there's nothing to encode yet. */
export function payloadFor(content: QrContent): string {
  switch (content.kind) {
    case 'link':
      return normalizeLink(content.url);
    case 'text':
      return content.text.trim();
    case 'wifi':
      return wifiPayload(content);
    case 'contact': {
      const { first, last, org, phone, email } = content.contact;
      return [first, last, org, phone, email].some((value) => value.trim())
        ? vcard(content.contact)
        : '';
    }
    case 'phone': {
      const number = cleanPhone(content.number);
      return number ? `tel:${number}` : '';
    }
    case 'sms':
      return smsPayload(content.number, content.message);
    case 'email':
      return mailtoPayload(content.to, content.subject, content.body);
  }
}

/** A short, human name for a code, for its file name. */
export function describeContent(content: QrContent): string {
  switch (content.kind) {
    case 'link':
      try {
        const url = new URL(normalizeLink(content.url));
        return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;
      } catch {
        return content.url;
      }
    case 'text':
      return content.text.slice(0, 32);
    case 'wifi':
      return `wifi-${content.ssid}`;
    case 'contact':
      return `contact-${[content.contact.first, content.contact.last].join(' ').trim() || content.contact.org}`;
    case 'phone':
      return `call-${cleanPhone(content.number)}`;
    case 'sms':
      return `text-${cleanPhone(content.number)}`;
    case 'email':
      return `email-${content.to}`;
  }
}
