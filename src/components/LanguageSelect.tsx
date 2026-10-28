import { Button } from '@cloudflare/kumo/components/button';
import { DropdownMenu } from '@cloudflare/kumo/components/dropdown';
import { TranslateIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLocale } from '../lib/i18n.ts';

/** Switch the interface language while preserving the current page and form state. */
export function LanguageSelect() {
    const { t, i18n } = useTranslation();
    const [open, setOpen] = useState(false);

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenu.Trigger render={<Button variant="ghost" shape="square" aria-label={t('Language')} />}>
                <TranslateIcon size={20} aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" sideOffset={8}>
                <DropdownMenu.RadioGroup
                    value={i18n.language}
                    onValueChange={(value) => {
                        if (value === 'en' || value === 'zh-CN') {
                            void changeLocale(value);
                            setOpen(false);
                        }
                    }}
                >
                    <DropdownMenu.RadioItem value="en">English</DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="zh-CN">简体中文</DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
        </DropdownMenu>
    );
}
