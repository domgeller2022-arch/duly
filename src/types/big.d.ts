/**
 * Type declarations for big.js 6.2.2.
 *
 * The DefinitelyTyped package describes a newer API surface that 6.2.2 does not
 * actually ship — it declares `isBig`, `isInteger` and `comparedTo`, none of
 * which exist in the installed version. Rather than code against methods that
 * would throw at runtime, these declarations mirror the real 6.2.2 surface
 * (`cmp`, `plus`, `times`, `round`, `toFixed`, `toNumber`) exactly.
 *
 * big.js is MIT licensed.
 */

declare module 'big.js' {
  type BigSource = number | string | Big;
  /** Rounding modes. `roundHalfUp` rounds away from zero. */
  type RoundingMode = 0 | 1 | 2 | 3;

  interface Big {
    /** Decimal digits, least significant first. */
    readonly c: number[];
    /** Exponent. */
    readonly e: number;
    /** Sign: -1 or 1. */
    readonly s: number;

    abs(): Big;
    /** -1 if this < n, 0 if equal, 1 if this > n. */
    cmp(n: BigSource): number;
    div(n: BigSource): Big;
    /** Alias for `times`. */
    mul(n: BigSource): Big;
    /** Alias for `plus`. */
    add(n: BigSource): Big;
    /** Alias for `minus`. */
    sub(n: BigSource): Big;
    eq(n: BigSource): boolean;
    gt(n: BigSource): boolean;
    gte(n: BigSource): boolean;
    lt(n: BigSource): boolean;
    lte(n: BigSource): boolean;
    minus(n: BigSource): Big;
    mod(n: BigSource): Big;
    neg(): Big;
    plus(n: BigSource): Big;
    pow(n: number): Big;
    /** Round to `sd` significant digits. */
    prec(sd: number, rm?: RoundingMode): Big;
    /** Round to `dp` decimal places. */
    round(dp: number, rm?: RoundingMode): Big;
    sqrt(): Big;
    times(n: BigSource): Big;
    toExponential(dp?: number, rm?: RoundingMode): string;
    toFixed(dp?: number, rm?: RoundingMode): string;
    toNumber(): number;
    toPrecision(sd?: number, rm?: RoundingMode): string;
    toString(): string;
    valueOf(): string;
  }

  interface BigConstructor {
    (value?: BigSource): Big;
    new (value?: BigSource): Big;

    /** Decimal places kept for division and sqrt. Default 20. */
    DP: number;
    /** Rounding mode used by division and sqrt. Default 1. */
    RM: RoundingMode;
    /** Reject values with more than 15 significant digits. */
    strict: boolean;

    readonly roundDown: 0;
    readonly roundHalfUp: 1;
    readonly roundHalfEven: 2;
    readonly roundUp: 3;

    /** Create an independent copy of this constructor. */
    (): BigConstructor;
    /** True when `n` was produced by this constructor. */
    isBig(n: unknown): boolean;
  }

  const Big: BigConstructor;
  export default Big;
  export type { Big as BigType, BigSource, RoundingMode };
}
