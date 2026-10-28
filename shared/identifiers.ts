import { isString } from 'lodash-es';

/** Shared API and HTML pattern; standalone dot segments are reserved by URL parsers. */
export const IDENTIFIER_PATTERN = /^(?!\.{1,2}$)(?:[A-Za-z0-9._]|-)+$/;

/** English validation message shared by all resource identifiers. */
export const IDENTIFIER_MESSAGE = 'Identifiers may contain only letters, numbers, dots, hyphens, and underscores; . and .. are reserved.';

/**
 * Validate a case-sensitive project, environment, or configuration identifier.
 * @param value - The untrusted identifier without normalization or case conversion.
 * @returns Whether the value is a nonempty, addressable identifier.
 */
export function isIdentifier(value: unknown): value is string {
    return isString(value) && IDENTIFIER_PATTERN.test(value);
}
