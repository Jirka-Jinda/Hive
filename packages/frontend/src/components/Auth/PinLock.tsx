import { useEffect, useRef, useState } from 'react';

interface Props {
    onUnlock: (pin: string) => void;
    failed: boolean;
}

export default function PinLock({ onUnlock, failed }: Props) {
    const [digits, setDigits] = useState<string[]>(['', '', '', '']);
    const [shake, setShake] = useState(false);
    const inputRefs = [
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
    ];

    // Focus first box on mount
    useEffect(() => {
        inputRefs[0].current?.focus();
    }, []);

    // Shake + clear on failed attempt
    useEffect(() => {
        if (!failed) return;
        setShake(true);
        const t = setTimeout(() => {
            setShake(false);
            setDigits(['', '', '', '']);
            inputRefs[0].current?.focus();
        }, 600);
        return () => clearTimeout(t);
    }, [failed]);

    const handleChange = (index: number, value: string) => {
        const digit = value.replace(/\D/g, '').slice(-1);
        const next = [...digits];
        next[index] = digit;
        setDigits(next);

        if (digit && index < 3) {
            inputRefs[index + 1].current?.focus();
        }

        if (digit && index === 3) {
            const pin = [...next.slice(0, 3), digit].join('');
            if (pin.length === 4) onUnlock(pin);
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            const next = [...digits];
            next[index - 1] = '';
            setDigits(next);
            inputRefs[index - 1].current?.focus();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950">
            <div className="flex flex-col items-center gap-8">
                {/* Logo */}
                <img src="/icon.svg" alt="Hive" className="w-20 h-20 opacity-90" draggable={false} />

                <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-gray-500 tracking-widest uppercase">Enter PIN to unlock</p>
                </div>

                {/* PIN boxes */}
                <div
                    className={`flex gap-4 ${shake ? 'animate-shake' : ''}`}
                >
                    {digits.map((d, i) => (
                        <input
                            key={i}
                            ref={inputRefs[i]}
                            type="password"
                            inputMode="numeric"
                            maxLength={1}
                            value={d}
                            onChange={(e) => handleChange(i, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(i, e)}
                            className={`w-14 h-14 text-center text-2xl font-bold rounded-xl border-2 bg-gray-900 text-white outline-none transition-all
                ${d
                                    ? 'border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                    : 'border-gray-700 focus:border-amber-500/70'
                                }
                ${shake ? 'border-red-500' : ''}
              `}
                            autoComplete="off"
                        />
                    ))}
                </div>

                {shake && (
                    <p className="text-xs text-red-400 tracking-wide">Incorrect PIN</p>
                )}
            </div>
        </div>
    );
}
