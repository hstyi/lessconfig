import { expect, test } from 'vitest';
import { isNewerVersion, isReleaseVersion } from '../../shared/versions';

test.each([
    ['1.10.0', '1.9.0', true],
    ['1.2.10', '1.2.9', true],
    ['2.0.0', '1.99.99', true],
    ['1.2.3', '1.2.3', false],
    ['1.2.2', '1.2.3', false],
    ['1.9.0', '1.10.0', false],
    ['0.0.0', '0.0.1', false],
    ['9007199254740991.0.0', '9007199254740990.0.0', true],
    ['1.2.3-beta.1', '1.2.2', false],
    ['v1.2.3', '1.2.2', false],
    ['1.2.3', 'invalid', false],
])('compares %s with %s numerically', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
});

test.each(['', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '-1.2.3', '1.2.3+build', '1.2.3\n', '9007199254740992.0.0', null, {}])(
    'rejects tags outside the stable x.y.z format: %j',
    (value) => {
        expect(isReleaseVersion(value)).toBe(false);
    },
);
