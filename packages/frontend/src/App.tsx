import { useEffect, useState } from 'react';
import AppShell from './components/Layout/AppShell';
import PinLock from './components/Auth/PinLock';
import { api } from './api/client';
import { useAppStore } from './store/appStore';

export default function App() {
    const isLocked = useAppStore((s) => s.isLocked);
    const unlock = useAppStore((s) => s.unlock);
    const lock = useAppStore((s) => s.lock);
    const [authChecked, setAuthChecked] = useState(false);
    const [pinFailed, setPinFailed] = useState(false);
    const [storedPin, setStoredPin] = useState('');

    // On mount: check if auth is enabled; if so, lock immediately
    useEffect(() => {
        api.settings.get().then((settings) => {
            if (settings.auth?.enabled && settings.auth?.pin) {
                setStoredPin(settings.auth.pin);
                lock();
            }
            setAuthChecked(true);
        }).catch(() => setAuthChecked(true));
    }, [lock]);

    const handleUnlock = (pin: string) => {
        const encoded = btoa(pin);
        if (encoded === storedPin) {
            setPinFailed(false);
            unlock();
        } else {
            setPinFailed(true);
            // Reset flag after shake completes so it can trigger again
            setTimeout(() => setPinFailed(false), 700);
        }
    };

    if (!authChecked) return null;

    if (isLocked) {
        return <PinLock onUnlock={handleUnlock} failed={pinFailed} />;
    }

    return <AppShell />;
}
