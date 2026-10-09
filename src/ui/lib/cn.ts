/**
 * Class-name helper.
 *
 * Two jobs: flatten conditional class names, and let a component's own class
 * override the defaults it was given without the caller reaching for
 * `!important`.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
