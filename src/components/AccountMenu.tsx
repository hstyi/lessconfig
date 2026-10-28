import { Button } from '@cloudflare/kumo/components/button';
import { DropdownMenu } from '@cloudflare/kumo/components/dropdown';
import { UserIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { changeLocale } from '../lib/i18n.ts';
import { RouterLink } from './RouterLink';

/** Keep account actions and language preferences in a compact dashboard menu. */
export function AccountMenu() {
    const { t, i18n } = useTranslation();
    const { user, logout } = useWorkspace();
    const [open, setOpen] = useState(false);

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenu.Trigger render={<Button variant="ghost" shape="square" aria-label={t('User menu')} />}>
                <UserIcon size={18} weight="fill" className="text-kumo-subtle" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" sideOffset={8} className="w-52">
                <DropdownMenu.Item disabled className="text-kumo-subtle">
                    {user.username}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.LinkItem href="/settings" render={<RouterLink />} onClick={() => setOpen(false)}>
                    {t('Account Settings')}
                </DropdownMenu.LinkItem>
                <DropdownMenu.LinkItem href="/api-keys" render={<RouterLink />} onClick={() => setOpen(false)}>
                    {t('API Tokens')}
                </DropdownMenu.LinkItem>
                <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger>{t('Language')}</DropdownMenu.SubTrigger>
                    <DropdownMenu.SubContent>
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
                    </DropdownMenu.SubContent>
                </DropdownMenu.Sub>
                <DropdownMenu.Separator />
                <DropdownMenu.Item variant="danger" onClick={() => void logout()}>
                    {t('Sign out')}
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu>
    );
}
