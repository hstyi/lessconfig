import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@cloudflare/kumo/components/button';
import { DatePicker } from '@cloudflare/kumo/components/date-picker';
import { Popover } from '@cloudflare/kumo/components/popover';
import { CalendarBlankIcon } from '@phosphor-icons/react';
import { enUS, zhCN } from 'date-fns/locale';
import { format, parseISO } from 'date-fns';

type ExpirationPickerProps = {
    value: string | undefined;
    onChange: (value: string | undefined) => void;
};

/** Select an inclusive UTC calendar date without converting the selected day to an instant. */
export function ExpirationPicker({ value, onChange }: ExpirationPickerProps) {
    const { t, i18n } = useTranslation();
    const labelId = useId();
    const [open, setOpen] = useState(false);
    const [today] = useState(() => parseISO(new Date().toISOString().slice(0, 10)));
    const selected = value ? parseISO(value) : undefined;
    const locale = i18n.language === 'zh-CN' ? zhCN : enUS;

    return (
        <div className="flex min-w-0 flex-col gap-2 [&>label]:font-medium">
            <label id={labelId}>{t('Expiration (optional)')}</label>
            <Popover.Root open={open} onOpenChange={setOpen}>
                <Popover.Trigger
                    render={
                        <Button
                            type="button"
                            icon={CalendarBlankIcon}
                            className="w-full justify-start py-0 [--kumo-button-text-lift:0px]"
                        />
                    }
                    aria-labelledby={labelId}
                >
                    {value ?? t('Select date')}
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Positioner side="bottom" align="start" className="z-100">
                        <Popover.Popup data-testid="expiration-calendar" className="z-100 max-w-[calc(100vw-2rem)] p-4">
                            <Popover.Title className="mb-2 font-medium">{t('Expiration date')}</Popover.Title>
                            <DatePicker
                                mode="single"
                                locale={locale}
                                selected={selected}
                                defaultMonth={selected ?? today}
                                disabled={{ before: today }}
                                onChange={(day) => {
                                    onChange(day ? format(day, 'yyyy-MM-dd') : undefined);
                                    setOpen(false);
                                }}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                    onChange(undefined);
                                    setOpen(false);
                                }}
                            >
                                {t('No expiration')}
                            </Button>
                        </Popover.Popup>
                    </Popover.Positioner>
                </Popover.Portal>
            </Popover.Root>
            <span className="text-kumo-subtle">{t('Valid through the selected date (UTC). Leave empty for no expiration.')}</span>
        </div>
    );
}
