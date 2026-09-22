import * as XLSX from 'xlsx';

export const SHEET_NAME = 'Coupon Master';
export const EXCLUDE_TEST_COUPONS_UP_TO = 20;
export const NUMBER_OF_WINNERS = 3;

function normalizeHeader(header) {
  return String(header)
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function normalizeCoupon(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : '';
  return String(value).trim();
}

export async function prepareExcel(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const worksheet = workbook.Sheets[SHEET_NAME];

  if (!worksheet) {
    throw new Error(`Could not find the "${SHEET_NAME}" sheet. Available sheets: ${workbook.SheetNames.join(', ')}`);
  }

  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  if (!rawRows.length) throw new Error(`"${SHEET_NAME}" contains no data.`);

  const rows = rawRows.map((row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) out[normalizeHeader(key)] = value;
    return out;
  });

  const required = [
    ['couponnumber', 'Coupon Number'],
    ['name', 'Name'],
    ['flatno', 'Flat No'],
  ];

  for (const [key, label] of required) {
    if (!(key in rows[0])) throw new Error(`Could not find the "${label}" column.`);
  }

  const source = rows
    .map((row, index) => ({
      originalCoupon: normalizeCoupon(row.couponnumber),
      name: String(row.name ?? '').trim(),
      flat: String(row.flatno ?? '').trim(),
      excelRow: index + 2,
    }))
    .filter((row) => row.originalCoupon || row.name || row.flat);

  const rawCount = source.length;
  const filtered = source.filter((p) => {
    const n = Number(p.originalCoupon);
    return !(Number.isInteger(n) && n >= 1 && n <= EXCLUDE_TEST_COUPONS_UP_TO);
  });

  const validationErrors = [];
  for (const p of filtered) {
    if (!p.originalCoupon) validationErrors.push(`Excel row ${p.excelRow}: missing coupon number`);
    else if (!/^\d+$/.test(p.originalCoupon)) validationErrors.push(`Excel row ${p.excelRow}: invalid coupon "${p.originalCoupon}"`);
    if (!p.name) validationErrors.push(`Coupon ${p.originalCoupon}: missing name`);
    if (!p.flat) validationErrors.push(`Coupon ${p.originalCoupon}: missing flat number`);
  }
  if (validationErrors.length) {
    throw new Error(`${validationErrors.length} validation error(s): ${validationErrors.slice(0, 5).join(' | ')}`);
  }

  if (!filtered.length) throw new Error('No eligible coupons remain after test-coupon removal.');

  const assigned = new Set();
  const originalSet = new Set(filtered.map((p) => p.originalCoupon));
  let maxCoupon = Math.max(...filtered.map((p) => Number(p.originalCoupon)));
  const changes = [];
  const participants = [];

  for (const p of filtered) {
    let assignedCoupon = p.originalCoupon;
    if (assigned.has(assignedCoupon)) {
      do maxCoupon += 1; while (originalSet.has(String(maxCoupon)) || assigned.has(String(maxCoupon)));
      assignedCoupon = String(maxCoupon);
      changes.push({
        originalCoupon: p.originalCoupon,
        assignedCoupon,
        name: p.name,
        flat: p.flat,
        excelRow: p.excelRow,
      });
    }
    assigned.add(assignedCoupon);
    participants.push({ ...p, assignedCoupon, drawCoupon: assignedCoupon });
  }

  const couponWidth = Math.max(...participants.map((p) => p.assignedCoupon.length));
  const prepared = participants.map((p) => ({
    ...p,
    drawCoupon: p.assignedCoupon.padStart(couponWidth, '0'),
  }));

  return {
    participants: prepared,
    couponWidth,
    sourceRows: rawCount,
    testCouponsRemoved: rawCount - filtered.length,
    duplicateChanges: changes,
  };
}

function secureRandomInt(max) {
  if (max <= 0) throw new Error('Invalid random range');
  if (crypto?.randomInt) return crypto.randomInt(0, max);
  const arr = new Uint32Array(1);
  const range = 2 ** 32;
  const limit = Math.floor(range / max) * max;
  do crypto.getRandomValues(arr); while (arr[0] >= limit);
  return arr[0] % max;
}

function weightedChoice(options) {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = secureRandomInt(total);
  for (const o of options) {
    if (r < o.weight) return o;
    r -= o.weight;
  }
  throw new Error('Random selection failed');
}

function buildTrie(participants) {
  const root = { count: 0, participant: null, children: {} };
  for (const p of participants) {
    let node = root;
    node.count += 1;
    for (const digit of p.drawCoupon) {
      if (!node.children[digit]) node.children[digit] = { count: 0, participant: null, children: {} };
      node = node.children[digit];
      node.count += 1;
    }
    node.participant = p;
  }
  return root;
}

export async function drawOneWinner(participants, couponWidth, onStep) {
  if (!participants.length) throw new Error('No participants remain.');
  const root = buildTrie(participants);
  let node = root;
  let prefix = '';

  for (let position = 0; position < couponWidth; position += 1) {
    const options = Object.entries(node.children).map(([digit, child]) => ({ digit, child, weight: child.count }));
    const selected = weightedChoice(options);
    prefix += selected.digit;
    node = selected.child;
    const step = {
      digit: selected.digit,
      prefix,
      position: position + 1,
      totalDigits: couponWidth,
      candidatesRemaining: node.count,
    };
    if (onStep) await onStep(step);
  }

  if (!node.participant) throw new Error('No winner found at final coupon node.');
  return { winner: node.participant };
}

export function personKey(participant) {
  return `${participant.name.trim().toLowerCase()}||${participant.flat.trim().toLowerCase()}`;
}

export function removeWinnerFromPool(participants, winner) {
  const key = personKey(winner);
  return participants.filter((p) => personKey(p) !== key);
}

export function getPersonCouponCount(participants, winner) {
  const key = personKey(winner);
  return participants.filter((p) => personKey(p) === key).length;
}
