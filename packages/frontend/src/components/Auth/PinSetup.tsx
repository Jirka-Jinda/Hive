import { useEffect, useRef, useState } from 'react';

interface Props {
    title?: string;
    description?: string;
    onConfirm: (pin: string) => void;
    onCancel?: () => void;
}

type Phase = 'enter' | 'confirm';

export default function PinSetup({
    title = 'Set a PIN',
    description = 'Choose a 4-digit PIN to protect Hive.',
    onConfirm,
    onCancel,
}: Props) {
    const [phase, setPhase] = useState<Phase>('enter');
    const [firstPin, setFirstPin] = useState('');
    const [digits, setDigits] = useState<string[]>(['', '', '', '']);
    const [mismatch, setMismatch] = useState(false);
    const inputRefs = [
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
    ];

    useEffect(() => {
        inputRefs[0].current?.focus();
    }, [phase]);

    const reset = () => {
        setDigits(['', '', '', '']);
        setMismatch(false);
        inputRefs[0].current?.focus();
    };

    const handleChange = (index: number, value: string) => {
        const digit = value.replace(/\D/g, '').slice(-1);
        const next = [...digits];
        next[index] = digit;
        setDigits(next);
        setMismatch(false);

        if (digit && index < 3) {
            inputRefs[index + 1].current?.focus();
        }

        if (digit && index === 3) {
            const pin = [...next.slice(0, 3), digit].join('');
            if (pin.length === 4) {
                if (phase === 'enter') {
                    setFirstPin(pin);
                    setPhase('confirm');
                    setDigits(['', '', '', '']);
                } else {
                    if (pin === firstPin) {
                        onConfirm(pin);
                    } else {
                        setMismatch(true);
                        setTimeout(() => {
                            setMismatch(false);
                            setDigits(['', '', '', '']);
                            inputRefs[0].current?.focus();
                        }, 700);
                    }
                }
            }
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
        <div className="flex flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-1 text-center">
                <h3 className="text-sm font-semibold text-gray-200">{phase === 'enter' ? title : 'Confirm PIN'}</h3>
                <p className="text-xs text-gray-500">
                    {phase === 'enter' ? description : 'Enter the same PIN again to confirm.'}
                </p>
            </div>

            <div className={`flex gap-3 ${mismatch ? 'animate-shake' : ''}`}>
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
                        className={`w-11 h-11 text-center text-xl font-bold rounded-lg border-2 bg-gray-950 text-white outline-none transition-all
              ${d ? 'border-amber-500' : 'border-gray-700 focus:border-amber-500/70'}
              ${mismatch ? 'border-red-500' : ''}
            `}
                        autoComplete="off"
                    />
                ))}
            </div>

            {mismatch && <p className="text-xs text-red-400">PINs don't match — try again</p>}

            <div className="flex gap-2">
                {phase === 'confirm' && (
                    <button
                        onClick={() => { setPhase('enter'); reset(); }}
                        className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 font-medium transition-all"
                    >
                        Back
                    </button>
                )}
                {onCancel && phase === 'enter' && (
                    <button
                        onClick={onCancel}
                        className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 font-medium transition-all"
                    >
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}
