/** Keep editable and diff views at a fixed height; important utilities override CodeMirror's unlayered defaults. */
export const configurationEditorClasses = [
    'h-80 min-w-0 overflow-hidden bg-kumo-base text-kumo-default',
    '[&_.cm-editor]:h-full! [&_.cm-editor.cm-focused]:outline-none! [&_.cm-editor.cm-focused]:border-0!',
    '[&_.cm-scroller]:h-full! [&_.cm-scroller]:min-h-0! [&_.cm-scroller]:overflow-auto! [&_.cm-scroller]:[scrollbar-gutter:stable]',
    '[&_.cm-scroller]:font-mono! [&_.cm-scroller]:text-base! [&_.cm-scroller]:leading-6!',
    '[&_.cm-content]:min-h-full! [&_.cm-content]:py-0! [&_.cm-line]:px-1.5!',
    // CodeMirror sets gutter min-height from the document; overriding it clips numbers after scrolling.
    '[&_.cm-gutters]:border-kumo-line! [&_.cm-gutters]:bg-kumo-tint! [&_.cm-gutters]:text-kumo-subtle!',
    '[&_.cm-activeLine]:bg-kumo-tint/50! [&_.cm-activeLineGutter]:bg-kumo-tint! [&_.cm-placeholder]:text-kumo-subtle!',
    '[&_.tok-keyword]:text-purple-700 [&_.tok-bool]:text-purple-700 [&_.tok-number]:text-violet-700',
    '[&_.tok-string]:text-emerald-700 [&_.tok-string2]:text-emerald-700 [&_.tok-meta]:text-purple-700',
    '[&_.tok-propertyName]:text-blue-700 [&_.tok-definition]:text-blue-700 [&_.tok-atom]:text-violet-700',
    '[&_.tok-comment]:text-kumo-subtle [&_.tok-heading]:text-blue-700',
].join(' ');
