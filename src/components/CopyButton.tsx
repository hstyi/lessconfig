import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';

/** Copy a value and expose success or failure through a visible button label. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
    const { t } = useTranslation();
    const [state, setState] = useState('');

    return (
        <Button
            variant="secondary"
            icon={state === 'Copied' ? CheckIcon : CopyIcon}
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(value);
                    setState('Copied');
                } catch {
                    setState('Copy failed. Copy the text manually.');
                }
            }}
        >
            {t(state || label)}
        </Button>
    );
}
