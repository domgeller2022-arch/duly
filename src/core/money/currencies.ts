/**
 * ISO 4217 currency table.
 *
 * `decimals` is the ISO 4217 minor-unit exponent — it decides how many digits of
 * precision a currency actually has (JPY 0, AUD 2, KWD 3, CLF 4). Money in Duly
 * is always an integer count of minor units, so this table is the single source
 * of truth for how integers map to human amounts.
 *
 * `symbol` is used for display only. Where an official symbol is ambiguous the
 * code is used instead, which is what most accounting packages do.
 */

export interface Currency {
  /** ISO 4217 alphabetic code. */
  code: string;
  /** Official currency name. */
  name: string;
  /** Minor-unit exponent: how many decimal places the currency has. */
  decimals: number;
  /** Display symbol, or the code when no unambiguous symbol exists. */
  symbol: string;
}

export const CURRENCIES: readonly Currency[] = [
  { code: 'AED', name: 'UAE Dirham', decimals: 2, symbol: 'AED' },
  { code: 'AFN', name: 'Afghani', decimals: 2, symbol: '؋' },
  { code: 'ALL', name: 'Lek', decimals: 2, symbol: 'L' },
  { code: 'AMD', name: 'Armenian Dram', decimals: 2, symbol: '֏' },
  { code: 'ANG', name: 'Netherlands Antillean Guilder', decimals: 2, symbol: 'ƒ' },
  { code: 'AOA', name: 'Kwanza', decimals: 2, symbol: 'Kz' },
  { code: 'ARS', name: 'Argentine Peso', decimals: 2, symbol: '$' },
  { code: 'AUD', name: 'Australian Dollar', decimals: 2, symbol: '$' },
  { code: 'AWG', name: 'Aruban Florin', decimals: 2, symbol: 'ƒ' },
  { code: 'AZN', name: 'Azerbaijani Manat', decimals: 2, symbol: '₼' },
  { code: 'BAM', name: 'Convertible Mark', decimals: 2, symbol: 'KM' },
  { code: 'BBD', name: 'Barbados Dollar', decimals: 2, symbol: '$' },
  { code: 'BDT', name: 'Taka', decimals: 2, symbol: '৳' },
  { code: 'BGN', name: 'Bulgarian Lev', decimals: 2, symbol: 'лв' },
  { code: 'BHD', name: 'Bahraini Dinar', decimals: 3, symbol: '.د.ب' },
  { code: 'BIF', name: 'Burundi Franc', decimals: 0, symbol: 'FBu' },
  { code: 'BMD', name: 'Bermudian Dollar', decimals: 2, symbol: '$' },
  { code: 'BND', name: 'Brunei Dollar', decimals: 2, symbol: '$' },
  { code: 'BOB', name: 'Boliviano', decimals: 2, symbol: 'Bs.' },
  { code: 'BRL', name: 'Brazilian Real', decimals: 2, symbol: 'R$' },
  { code: 'BSD', name: 'Bahamian Dollar', decimals: 2, symbol: '$' },
  { code: 'BTN', name: 'Ngultrum', decimals: 2, symbol: 'Nu.' },
  { code: 'BWP', name: 'Pula', decimals: 2, symbol: 'P' },
  { code: 'BYN', name: 'Belarusian Ruble', decimals: 2, symbol: 'Br' },
  { code: 'BZD', name: 'Belize Dollar', decimals: 2, symbol: 'BZ$' },
  { code: 'CAD', name: 'Canadian Dollar', decimals: 2, symbol: '$' },
  { code: 'CDF', name: 'Congolese Franc', decimals: 2, symbol: 'FC' },
  { code: 'CHF', name: 'Swiss Franc', decimals: 2, symbol: 'CHF' },
  { code: 'CLF', name: 'Unidad de Fomento', decimals: 4, symbol: 'UF' },
  { code: 'CLP', name: 'Chilean Peso', decimals: 0, symbol: '$' },
  { code: 'CNY', name: 'Renminbi', decimals: 2, symbol: '¥' },
  { code: 'COP', name: 'Colombian Peso', decimals: 2, symbol: '$' },
  { code: 'CRC', name: 'Costa Rican Colon', decimals: 2, symbol: '₡' },
  { code: 'CUP', name: 'Cuban Peso', decimals: 2, symbol: '$' },
  { code: 'CVE', name: 'Cabo Verde Escudo', decimals: 2, symbol: '$' },
  { code: 'CZK', name: 'Czech Koruna', decimals: 2, symbol: 'Kč' },
  { code: 'DJF', name: 'Djibouti Franc', decimals: 0, symbol: 'Fdj' },
  { code: 'DKK', name: 'Danish Krone', decimals: 2, symbol: 'kr' },
  { code: 'DOP', name: 'Dominican Peso', decimals: 2, symbol: 'RD$' },
  { code: 'DZD', name: 'Algerian Dinar', decimals: 2, symbol: 'د.ج' },
  { code: 'EGP', name: 'Egyptian Pound', decimals: 2, symbol: 'E£' },
  { code: 'ERN', name: 'Nakfa', decimals: 2, symbol: 'Nfk' },
  { code: 'ETB', name: 'Ethiopian Birr', decimals: 2, symbol: 'Br' },
  { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€' },
  { code: 'FJD', name: 'Fiji Dollar', decimals: 2, symbol: '$' },
  { code: 'FKP', name: 'Falkland Islands Pound', decimals: 2, symbol: '£' },
  { code: 'GBP', name: 'Pound Sterling', decimals: 2, symbol: '£' },
  { code: 'GEL', name: 'Lari', decimals: 2, symbol: '₾' },
  { code: 'GHS', name: 'Ghana Cedi', decimals: 2, symbol: '₵' },
  { code: 'GIP', name: 'Gibraltar Pound', decimals: 2, symbol: '£' },
  { code: 'GMD', name: 'Dalasi', decimals: 2, symbol: 'D' },
  { code: 'GNF', name: 'Guinean Franc', decimals: 0, symbol: 'FG' },
  { code: 'GTQ', name: 'Quetzal', decimals: 2, symbol: 'Q' },
  { code: 'GYD', name: 'Guyana Dollar', decimals: 2, symbol: '$' },
  { code: 'HKD', name: 'Hong Kong Dollar', decimals: 2, symbol: '$' },
  { code: 'HNL', name: 'Lempira', decimals: 2, symbol: 'L' },
  { code: 'HTG', name: 'Gourde', decimals: 2, symbol: 'G' },
  { code: 'HUF', name: 'Forint', decimals: 2, symbol: 'Ft' },
  { code: 'IDR', name: 'Rupiah', decimals: 2, symbol: 'Rp' },
  { code: 'ILS', name: 'New Israeli Sheqel', decimals: 2, symbol: '₪' },
  { code: 'INR', name: 'Indian Rupee', decimals: 2, symbol: '₹' },
  { code: 'IQD', name: 'Iraqi Dinar', decimals: 3, symbol: 'ع.د' },
  { code: 'IRR', name: 'Iranian Rial', decimals: 2, symbol: '﷼' },
  { code: 'ISK', name: 'Iceland Krona', decimals: 0, symbol: 'kr' },
  { code: 'JMD', name: 'Jamaican Dollar', decimals: 2, symbol: 'J$' },
  { code: 'JOD', name: 'Jordanian Dinar', decimals: 3, symbol: 'د.ا' },
  { code: 'JPY', name: 'Yen', decimals: 0, symbol: '¥' },
  { code: 'KES', name: 'Kenyan Shilling', decimals: 2, symbol: 'KSh' },
  { code: 'KGS', name: 'Som', decimals: 2, symbol: 'с' },
  { code: 'KHR', name: 'Riel', decimals: 2, symbol: '៛' },
  { code: 'KMF', name: 'Comorian Franc', decimals: 0, symbol: 'CF' },
  { code: 'KPW', name: 'North Korean Won', decimals: 2, symbol: '₩' },
  { code: 'KRW', name: 'Won', decimals: 0, symbol: '₩' },
  { code: 'KWD', name: 'Kuwaiti Dinar', decimals: 3, symbol: 'د.ك' },
  { code: 'KYD', name: 'Cayman Islands Dollar', decimals: 2, symbol: '$' },
  { code: 'KZT', name: 'Tenge', decimals: 2, symbol: '₸' },
  { code: 'LAK', name: 'Lao Kip', decimals: 2, symbol: '₭' },
  { code: 'LBP', name: 'Lebanese Pound', decimals: 2, symbol: 'ل.ل' },
  { code: 'LKR', name: 'Sri Lanka Rupee', decimals: 2, symbol: 'Rs' },
  { code: 'LRD', name: 'Liberian Dollar', decimals: 2, symbol: '$' },
  { code: 'LSL', name: 'Loti', decimals: 2, symbol: 'L' },
  { code: 'LYD', name: 'Libyan Dinar', decimals: 3, symbol: 'ل.د' },
  { code: 'MAD', name: 'Moroccan Dirham', decimals: 2, symbol: 'د.م.' },
  { code: 'MDL', name: 'Moldovan Leu', decimals: 2, symbol: 'L' },
  { code: 'MGA', name: 'Malagasy Ariary', decimals: 2, symbol: 'Ar' },
  { code: 'MKD', name: 'Denar', decimals: 2, symbol: 'ден' },
  { code: 'MMK', name: 'Kyat', decimals: 2, symbol: 'K' },
  { code: 'MNT', name: 'Tugrik', decimals: 2, symbol: '₮' },
  { code: 'MOP', name: 'Pataca', decimals: 2, symbol: 'P' },
  { code: 'MRU', name: 'Ouguiya', decimals: 2, symbol: 'UM' },
  { code: 'MUR', name: 'Mauritius Rupee', decimals: 2, symbol: '₨' },
  { code: 'MVR', name: 'Rufiyaa', decimals: 2, symbol: 'ރ' },
  { code: 'MWK', name: 'Malawi Kwacha', decimals: 2, symbol: 'MK' },
  { code: 'MXN', name: 'Mexican Peso', decimals: 2, symbol: '$' },
  { code: 'MYR', name: 'Malaysian Ringgit', decimals: 2, symbol: 'RM' },
  { code: 'MZN', name: 'Mozambique Metical', decimals: 2, symbol: 'MT' },
  { code: 'NAD', name: 'Namibia Dollar', decimals: 2, symbol: '$' },
  { code: 'NGN', name: 'Naira', decimals: 2, symbol: '₦' },
  { code: 'NIO', name: 'Cordoba Oro', decimals: 2, symbol: 'C$' },
  { code: 'NOK', name: 'Norwegian Krone', decimals: 2, symbol: 'kr' },
  { code: 'NPR', name: 'Nepalese Rupee', decimals: 2, symbol: '₨' },
  { code: 'NZD', name: 'New Zealand Dollar', decimals: 2, symbol: '$' },
  { code: 'OMR', name: 'Rial Omani', decimals: 3, symbol: 'ر.ع.' },
  { code: 'PAB', name: 'Balboa', decimals: 2, symbol: 'B/.' },
  { code: 'PEN', name: 'Sol', decimals: 2, symbol: 'S/' },
  { code: 'PGK', name: 'Kina', decimals: 2, symbol: 'K' },
  { code: 'PHP', name: 'Philippine Peso', decimals: 2, symbol: '₱' },
  { code: 'PKR', name: 'Pakistan Rupee', decimals: 2, symbol: '₨' },
  { code: 'PLN', name: 'Polish Zloty', decimals: 2, symbol: 'zł' },
  { code: 'PYG', name: 'Guarani', decimals: 0, symbol: '₲' },
  { code: 'QAR', name: 'Qatari Rial', decimals: 2, symbol: 'ر.ق' },
  { code: 'RON', name: 'Romanian Leu', decimals: 2, symbol: 'lei' },
  { code: 'RSD', name: 'Serbian Dinar', decimals: 2, symbol: 'дин' },
  { code: 'RUB', name: 'Russian Ruble', decimals: 2, symbol: '₽' },
  { code: 'RWF', name: 'Rwanda Franc', decimals: 0, symbol: 'FRw' },
  { code: 'SAR', name: 'Saudi Riyal', decimals: 2, symbol: '﷼' },
  { code: 'SBD', name: 'Solomon Islands Dollar', decimals: 2, symbol: '$' },
  { code: 'SCR', name: 'Seychelles Rupee', decimals: 2, symbol: '₨' },
  { code: 'SDG', name: 'Sudanese Pound', decimals: 2, symbol: 'ج.س.' },
  { code: 'SEK', name: 'Swedish Krona', decimals: 2, symbol: 'kr' },
  { code: 'SGD', name: 'Singapore Dollar', decimals: 2, symbol: '$' },
  { code: 'SHP', name: 'Saint Helena Pound', decimals: 2, symbol: '£' },
  { code: 'SLE', name: 'Leone', decimals: 2, symbol: 'Le' },
  { code: 'SOS', name: 'Somali Shilling', decimals: 2, symbol: 'Sh' },
  { code: 'SRD', name: 'Surinam Dollar', decimals: 2, symbol: '$' },
  { code: 'SSP', name: 'South Sudanese Pound', decimals: 2, symbol: '£' },
  { code: 'STN', name: 'Dobra', decimals: 2, symbol: 'Db' },
  { code: 'SVC', name: 'El Salvador Colon', decimals: 2, symbol: '₡' },
  { code: 'SYP', name: 'Syrian Pound', decimals: 2, symbol: '£' },
  { code: 'SZL', name: 'Lilangeni', decimals: 2, symbol: 'E' },
  { code: 'THB', name: 'Baht', decimals: 2, symbol: '฿' },
  { code: 'TJS', name: 'Somoni', decimals: 2, symbol: 'ЅМ' },
  { code: 'TMT', name: 'Turkmenistan New Manat', decimals: 2, symbol: 'm' },
  { code: 'TND', name: 'Tunisian Dinar', decimals: 3, symbol: 'د.ت' },
  { code: 'TOP', name: 'Pa’anga', decimals: 2, symbol: 'T$' },
  { code: 'TRY', name: 'Turkish Lira', decimals: 2, symbol: '₺' },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar', decimals: 2, symbol: 'TT$' },
  { code: 'TWD', name: 'New Taiwan Dollar', decimals: 2, symbol: 'NT$' },
  { code: 'TZS', name: 'Tanzanian Shilling', decimals: 2, symbol: 'TSh' },
  { code: 'UAH', name: 'Hryvnia', decimals: 2, symbol: '₴' },
  { code: 'UGX', name: 'Uganda Shilling', decimals: 0, symbol: 'USh' },
  { code: 'USD', name: 'US Dollar', decimals: 2, symbol: '$' },
  { code: 'USN', name: 'US Dollar (next day)', decimals: 2, symbol: '$' },
  { code: 'UYU', name: 'Peso Uruguayo', decimals: 2, symbol: '$U' },
  { code: 'UZS', name: 'Uzbekistan Sum', decimals: 2, symbol: 'so‘m' },
  { code: 'VES', name: 'Bolívar Soberano', decimals: 2, symbol: 'Bs.' },
  { code: 'VND', name: 'Dong', decimals: 0, symbol: '₫' },
  { code: 'VUV', name: 'Vatu', decimals: 0, symbol: 'VT' },
  { code: 'WST', name: 'Tala', decimals: 2, symbol: 'T' },
  { code: 'XAF', name: 'CFA Franc BEAC', decimals: 0, symbol: 'FCFA' },
  { code: 'XCD', name: 'East Caribbean Dollar', decimals: 2, symbol: '$' },
  { code: 'XCG', name: 'Caribbean Guilder', decimals: 2, symbol: 'Cg' },
  { code: 'XOF', name: 'CFA Franc BCEAO', decimals: 0, symbol: 'CFA' },
  { code: 'XPF', name: 'CFP Franc', decimals: 0, symbol: '₣' },
  { code: 'YER', name: 'Yemeni Rial', decimals: 2, symbol: '﷼' },
  { code: 'ZAR', name: 'South African Rand', decimals: 2, symbol: 'R' },
  { code: 'ZMW', name: 'Zambian Kwacha', decimals: 2, symbol: 'ZK' },
  { code: 'ZWG', name: 'Zimbabwe Gold', decimals: 2, symbol: 'ZiG' },
] as const;

const BY_CODE = new Map<string, Currency>(CURRENCIES.map((c) => [c.code, c]));

export const DEFAULT_CURRENCY = 'AUD';

/** Currency used when a code is unknown — never throws, so imports stay readable. */
const FALLBACK: Currency = { code: 'XXX', name: 'Unknown currency', decimals: 2, symbol: '' };

export function getCurrency(code: string): Currency {
  return BY_CODE.get(code?.toUpperCase?.() ?? '') ?? { ...FALLBACK, code: code?.toUpperCase?.() || 'XXX' };
}

/** Minor-unit exponent for a currency. Unknown codes fall back to 2 decimals. */
export function currencyDecimals(code: string): number {
  return getCurrency(code).decimals;
}

/** A power of ten matching the currency's minor unit, as a number. */
export function minorUnitFactor(code: string): number {
  return Math.pow(10, currencyDecimals(code));
}

export function isKnownCurrency(code: string): boolean {
  return BY_CODE.has(code?.toUpperCase?.() ?? '');
}

/**
 * Currencies that cannot carry a decimal part. Used by the UI to hide the
 * cents stepper and to reject fractional input on JPY, KRW, VND and friends.
 */
export function isZeroDecimalCurrency(code: string): boolean {
  return currencyDecimals(code) === 0;
}

/** Currencies commonly quoted by financial institutions as a FX reference. */
export const COMMON_CURRENCIES = [
  'AUD',
  'NZD',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'SGD',
  'CHF',
  'HKD',
] as const;

/** Search helper for the currency picker. */
export function searchCurrencies(query: string): Currency[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...CURRENCIES];
  return CURRENCIES.filter(
    (c) =>
      c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase() === q,
  );
}
