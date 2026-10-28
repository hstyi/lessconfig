import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { classHighlighter } from '@lezer/highlight';
import type { ConfigType } from '../lib/api.ts';
import { configurationLanguage } from '../lib/configurationLanguage.ts';
import { configurationEditorClasses } from '../lib/configurationEditorClasses.ts';

/** Show a read-only, syntax-highlighted unified diff without merge controls. */
export function ConfigDiff({ before, after, type, label }: { before: string; after: string; type: ConfigType; label: string }) {
    const host = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!host.current) {
            return;
        }

        const view = new EditorView({
            parent: host.current,
            doc: after,
            extensions: [
                EditorState.readOnly.of(true),
                EditorView.editable.of(false),
                EditorState.tabSize.of(2),
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({ 'aria-label': label, tabindex: '0' }),
                lineNumbers(),
                configurationLanguage(type),
                syntaxHighlighting(classHighlighter),
                unifiedMergeView({
                    original: before,
                    mergeControls: false,
                    syntaxHighlightDeletions: true,
                    syntaxHighlightDeletionsMaxLength: 256 * 1024,
                    gutter: true,
                }),
            ],
        });

        return () => view.destroy();
    }, [before, after, type, label]);

    return <div ref={host} data-testid="history-diff" className={configurationEditorClasses} />;
}
