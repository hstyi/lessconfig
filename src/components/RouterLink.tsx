import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';

/** Adapt Kumo links to React Router while preserving native anchor interactions. */
export const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(function RouterLink(
    { href = '/', ...props },
    ref,
) {
    return <Link ref={ref} to={href} {...props} />;
});
