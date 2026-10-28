import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import {
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    placeholder as editorPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import type { ConfigType } from '../lib/api.ts';
import { configurationLanguage } from '../lib/configurationLanguage.ts';
import { configurationEditorClasses } from '../lib/configurationEditorClasses.ts';

/** Controlled configuration content with syntax selected by its declared type. */
interface ConfigEditorProps {
    value: string;
    type: ConfigType;
    label: string;
    placeholder: string;
    onChange: (value: string) => void;
}

const externalChange = Annotation.define<boolean>();

/** Mount one editor and reconfigure it without losing focus, selection, or undo history. */
export function ConfigEditor({ value, type, label, placeholder, onChange }: ConfigEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const editor = useRef<EditorView | null>(null);
    const initial = useRef({ value, type, label, placeholder });
    const [compartments] = useState(() => ({
        language: new Compartment(),
        attributes: new Compartment(),
        placeholder: new Compartment(),
    }));
    const notifyChange = useEffectEvent(onChange);

    useEffect(() => {
        if (!host.current) {
            return;
        }

        const start = initial.current;
        const view = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: start.value,
                extensions: [
                    lineNumbers(),
                    highlightActiveLineGutter(),
                    highlightSpecialChars(),
                    drawSelection(),
                    highlightActiveLine(),
                    history(),
                    indentOnInput(),
                    indentUnit.of('  '),
                    EditorState.tabSize.of(2),
                    bracketMatching(),
                    EditorView.lineWrapping,
                    // Leave Tab available for navigating out of the editor with the keyboard.
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    syntaxHighlighting(classHighlighter),
                    compartments.language.of(configurationLanguage(start.type)),
                    compartments.attributes.of(
                        EditorView.contentAttributes.of({
                            'aria-label': start.label,
                            'aria-multiline': 'true',
                            spellcheck: 'false',
                        }),
                    ),
                    compartments.placeholder.of(editorPlaceholder(start.placeholder)),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged && update.transactions.some((transaction) => !transaction.annotation(externalChange))) {
                            notifyChange(update.state.sliceDoc());
                        }
                    }),
                ],
            }),
        });

        editor.current = view;

        return () => {
            editor.current = null;
            view.destroy();
        };
    }, [compartments]);
    useEffect(() => {
        editor.current?.dispatch({
            effects: compartments.language.reconfigure(configurationLanguage(type)),
        });
    }, [compartments, type]);
    useEffect(() => {
        editor.current?.dispatch({
            effects: [
                compartments.attributes.reconfigure(
                    EditorView.contentAttributes.of({
                        'aria-label': label,
                        'aria-multiline': 'true',
                        spellcheck: 'false',
                    }),
                ),
                compartments.placeholder.reconfigure(editorPlaceholder(placeholder)),
            ],
        });
    }, [compartments, label, placeholder]);
    useEffect(() => {
        const view = editor.current;

        // Synchronize external resets without echoing them back as edits.
        if (view && view.state.sliceDoc() !== value) {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: value },
                annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
            });
        }
    }, [value]);

    return <div ref={host} className={configurationEditorClasses} />;
}
