import { Outlet } from 'react-router';
import { PageFrame } from '../components/PageFrame';

/** Render account-level pages beneath the shared application titlebar. */
export function PageLayout() {
    return (
        <PageFrame>
            <Outlet />
        </PageFrame>
    );
}
