import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

BigInt.prototype.toLocaleString = BigInt.prototype.toLocaleString ?? (() => '');
