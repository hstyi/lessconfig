import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Tooltip } from '@cloudflare/kumo/components/tooltip';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';

/** Copy a value and expose success or failure through visible feedback. */
export function CopyButton({ value, label = 'Copy', inline = false }: { value: string; label?: string; inline?: boolean }) {
    const { t } = useTranslation();
    const [state, setState] = useState('');
    const [tooltipOpen, setTooltipOpen] = useState(false);

    async function copy() {
        if (inline) {
            setTooltipOpen(true);
        }

        try {
            await navigator.clipboard.writeText(value);
            setState('Copied');
        } catch {
            setState('Copy failed. Copy the text manually.');
        }
    }

    if (inline) {
        return (
            <Tooltip
                open={tooltipOpen}
                onOpenChange={(open, details) => {
                    if (details.reason === 'trigger-press') {
                        details.cancel();
                        return;
                    }

                    if (open) {
                        setState('');
                    }

                    setTooltipOpen(open);
                }}
                side="top"
                delay={0}
                closeDelay={0}
                disableHoverablePopup
                className="cursor-pointer rounded text-left hover:text-kumo-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-brand"
                content={
                    <span role="status" className="flex items-center gap-2 whitespace-nowrap">
                        {t(state || 'Copy')}
                        {state === 'Copied' && <CheckIcon size={16} aria-hidden="true" />}
                    </span>
                }
                render={<button type="button" onClick={copy} />}
            >
                <span className="font-mono text-[0.9em]">{label}</span>
            </Tooltip>
        );
    }

    return (
        <Button variant="secondary" icon={state === 'Copied' ? CheckIcon : CopyIcon} onClick={copy}>
            {t(state || label)}
        </Button>
    );
}
