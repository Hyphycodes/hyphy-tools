import { expect, test } from '@playwright/test';
import { qrMatrix } from '@/lib/tools/qr';
import {
  cleanPhone,
  isWebLink,
  mailtoPayload,
  normalizeLink,
  payloadFor,
  smsPayload,
  vcard,
  emptyContact,
} from '@/lib/tools/qr-payloads';
import {
  contrast,
  logoArea,
  qrShapes,
  scanRisks,
  shapesToSvg,
  type QrLook,
} from '@/lib/tools/qr-style';

/* QR Studio: what a code says, and styles that keep it readable. */

const look: QrLook = {
  dot: 'square',
  corner: 'square',
  fg: '#12110d',
  bg: '#ffffff',
  corners: '',
  margin: 4,
};

test('links become web addresses people can open', () => {
  expect(normalizeLink('yourshop.example/menu')).toBe('https://yourshop.example/menu');
  expect(normalizeLink('https://a.example')).toBe('https://a.example');
  expect(normalizeLink('mailto:a@b.example')).toBe('mailto:a@b.example');
  expect(isWebLink('yourshop.example')).toBe(true);
  expect(isWebLink('javascript:alert(1)')).toBe(false);
  expect(isWebLink('hello')).toBe(false);
});

test('calls, texts and email use the formats cameras understand', () => {
  expect(cleanPhone(' +1 (555) 010-0199 ')).toBe('+15550100199');
  expect(payloadFor({ kind: 'phone', number: '555 0100' })).toBe('tel:5550100');
  expect(smsPayload('+1 555 0100', 'Table for 4?')).toBe('SMSTO:+15550100:Table for 4?');
  expect(mailtoPayload('hi@shop.example', 'Catering', 'Hello & thanks')).toBe(
    'mailto:hi@shop.example?subject=Catering&body=Hello%20%26%20thanks',
  );
  expect(payloadFor({ kind: 'email', to: '', subject: 'x', body: '' })).toBe('');
});

test('a contact card escapes what vCards need escaped', () => {
  const card = vcard({
    ...emptyContact,
    first: 'Rosa',
    last: 'Delgado',
    org: 'Salt; Ember, Co',
    phone: '+1 555 010 0199',
    email: 'rosa@saltandember.example',
  });
  expect(card.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true);
  expect(card).toContain('N:Delgado;Rosa;;;');
  expect(card).toContain('ORG:Salt\\; Ember\\, Co');
  expect(card).toContain('TEL;TYPE=CELL:+15550100199');
  expect(card.endsWith('END:VCARD')).toBe(true);
  expect(payloadFor({ kind: 'contact', contact: emptyContact })).toBe('');
});

test('Wi-Fi codes carry the network', () => {
  expect(
    payloadFor({
      kind: 'wifi',
      ssid: 'Studio;Guest',
      password: 'pa:ss',
      security: 'WPA',
      hidden: false,
    }),
  ).toBe('WIFI:T:WPA;S:Studio\\;Guest;P:pa\\:ss;;');
});

test('every style keeps the three corner squares whole', () => {
  const matrix = qrMatrix('https://hyphy-studio.example/tools', 'M');
  for (const dot of ['square', 'rounded', 'dots', 'bars'] as const)
    for (const corner of ['square', 'rounded', 'circle'] as const) {
      const { shapes, total } = qrShapes(matrix, { ...look, dot, corner }, null);
      expect(total).toBe(matrix.length + 8);
      expect(shapes.filter((shape) => shape.type === 'ring')).toHaveLength(3);
      // Nothing is drawn inside a corner square except the corner itself.
      const inCorner = shapes.filter(
        (shape) =>
          shape.type !== 'ring' &&
          'x' in shape &&
          shape.x > 4.5 &&
          shape.x < 10.5 &&
          shape.y > 4.5 &&
          shape.y < 10.5,
      );
      expect(inCorner.every((shape) => shape.type === 'rect' && shape.w === 3)).toBe(true);
    }
});

test('a logo covers only the middle and leaves the code around it', () => {
  const matrix = qrMatrix('https://hyphy-studio.example/tools', 'H');
  const area = logoArea(matrix.length, 0.3);
  expect(area.side).toBeLessThanOrEqual(Math.ceil(matrix.length * 0.24) + 1);
  expect(area.start * 2 + area.side).toBe(matrix.length);
  const { shapes } = qrShapes(matrix, look, {
    src: 'data:image/png;base64,AAAA',
    size: 0.2,
    plate: true,
  });
  expect(shapes.filter((shape) => shape.type === 'image')).toHaveLength(1);
});

test('risks are named before anything is printed', () => {
  expect(scanRisks(look, null)).toEqual([]);
  expect(scanRisks({ ...look, fg: '#dddddd' }, null).join(' ')).toContain('Low contrast');
  expect(scanRisks({ ...look, fg: '#ffffff', bg: '#000000' }, null).join(' ')).toContain(
    'Light code',
  );
  expect(scanRisks({ ...look, margin: 1 }, null).join(' ')).toContain('thin border');
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
});

test('the SVG is a complete, escaped document', () => {
  const matrix = qrMatrix('hi', 'L');
  const { shapes, total } = qrShapes(matrix, { ...look, dot: 'dots' }, null);
  const svg = shapesToSvg(shapes, total, {
    bg: '#ffffff',
    caption: 'Scan <me> & go',
    captionColor: '#000000',
  });
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('Scan &lt;me&gt; &amp; go');
  expect(svg.endsWith('</svg>')).toBe(true);
});
