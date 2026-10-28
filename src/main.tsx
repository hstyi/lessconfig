import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/i18n.ts';
import App from './App.tsx';
import { BrowserRouter } from 'react-router';
import { Toasty } from '@cloudflare/kumo/components/toast';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            <Toasty>
                <App />
            </Toasty>
        </BrowserRouter>
    </StrictMode>,
);
