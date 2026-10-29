import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, LinkButton } from '@cloudflare/kumo/components/button';
import { ArrowCircleUpIcon, ArrowSquareOutIcon } from '@phosphor-icons/react';
import { releaseRepository, useReleaseUpdate } from '../hooks/useReleaseUpdate';
import { Modal } from './Modal';

const Markdown = lazy(() => import('react-markdown'));

/** Offer release notes beside the account menu when a newer stable release is available. */
export function ReleaseUpdate() {
    const { t } = useTranslation();
    const release = useReleaseUpdate();
    const [open, setOpen] = useState(false);

    return (
        <>
            {release && (
                <Button
                    variant="ghost"
                    icon={ArrowCircleUpIcon}
                    aria-label={t('Update available')}
                    title={t('New version {{version}}', { version: release.version })}
                    className="text-kumo-link"
                    onClick={() => setOpen(true)}
                >
                    <span className="hidden sm:inline">{t('New version')}</span>
                </Button>
            )}
            <Modal
                open={open && Boolean(release)}
                onClose={() => setOpen(false)}
                title={t('New version available')}
                description={t('Version update', { current: __APP_VERSION__, latest: release?.version ?? '' })}
            >
                <h3 className="mb-3 font-medium">{t('Release notes')}</h3>
                <div className="max-h-[50dvh] overflow-y-auto rounded-md bg-kumo-tint/40 p-4 text-sm wrap-anywhere [&_a]:text-kumo-link [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-kumo-tint [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-medium [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-kumo-tint [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
                    <Suspense fallback={<p>{t('Loading release notes…')}</p>}>
                        <Markdown
                            skipHtml
                            urlTransform={(url) => {
                                try {
                                    const resolved = new URL(url, `${releaseRepository}/`);
                                    return ['https:', 'http:'].includes(resolved.protocol) ? resolved.href : '';
                                } catch {
                                    return '';
                                }
                            }}
                            components={{
                                a: ({ href, children }) => (
                                    <a href={href} target="_blank" rel="noopener noreferrer">
                                        {children}
                                    </a>
                                ),
                                img: () => null,
                            }}
                        >
                            {release?.notes.trim() || t('No release notes provided.')}
                        </Markdown>
                    </Suspense>
                </div>
                <div className="mt-5 flex justify-end gap-3">
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                        {t('Close')}
                    </Button>
                    <LinkButton
                        variant="primary"
                        icon={ArrowSquareOutIcon}
                        href={`${releaseRepository}/releases/tag/${release?.version ?? ''}`}
                        external
                    >
                        {t('View release')}
                    </LinkButton>
                </div>
            </Modal>
        </>
    );
}
