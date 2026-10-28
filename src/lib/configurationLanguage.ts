import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import type { ConfigType } from './api.ts';

const propertiesLanguage = StreamLanguage.define(properties);

/** Plain text stays unparsed; numeric values share JSON's number highlighting. */
export function configurationLanguage(type: ConfigType): Extension {
    switch (type) {
        case 'json':

        case 'number':
            return json();

        case 'yaml':
            return yaml();

        case 'properties':
            return propertiesLanguage;

        default:
            return [];
    }
}
