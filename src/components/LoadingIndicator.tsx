import { useEffect, useState } from 'react';
import { Loader } from '@cloudflare/kumo/components/loader';

/** Delay the spinner for fast requests and reserve its width to avoid layout shifts. */
export function LoadingIndicator({ active, label }: { active: boolean; label: string }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setVisible(active), active ? 150 : 0);

        return () => clearTimeout(timer);
    }, [active]);

    return (
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-kumo-subtle">
            {active && visible && <Loader size="sm" aria-label={label} />}
        </span>
    );
}
