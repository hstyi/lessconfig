import { SkeletonLine } from '@cloudflare/kumo/components/loader';

/** Reserve list-shaped space only while the first response is unavailable. */
export function ListSkeleton({ label }: { label: string }) {
    return (
        <div role="status" aria-label={label} className="min-h-56 px-5 py-5">
            <div aria-hidden="true" className="divide-y divide-kumo-line">
                {[0, 1, 2, 3].map((row) => (
                    <div key={row} className="grid grid-cols-[2fr_1fr_1fr] items-center gap-6 py-4">
                        <SkeletonLine minWidth={50} maxWidth={75} />
                        <SkeletonLine minWidth={40} maxWidth={65} />
                        <SkeletonLine minWidth={55} maxWidth={80} />
                    </div>
                ))}
            </div>
        </div>
    );
}
