import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalView from './TerminalView';

const terminalMock = vi.hoisted(() => ({
    fit: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    open: vi.fn(),
    onData: vi.fn(),
    send: vi.fn(),
    sendResize: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
    Terminal: class {
        cols = 120;
        rows = 30;
        loadAddon = terminalMock.loadAddon;
        open = terminalMock.open;
        focus = terminalMock.focus;
        dispose = terminalMock.dispose;
        onData = terminalMock.onData;
    },
}));

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: class {
        fit = terminalMock.fit;
    },
}));

vi.mock('../../hooks/useWebSocket', () => ({
    useWebSocket: vi.fn().mockImplementation(() => ({
        send: terminalMock.send,
        sendResize: terminalMock.sendResize,
    })),
}));

describe('TerminalView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('re-fits and focuses when the session terminal is mounted again', () => {
        const firstMount = render(<TerminalView sessionId={11} />);

        act(() => {
            vi.advanceTimersByTime(60);
        });

        expect(terminalMock.fit).toHaveBeenCalledTimes(1);
        expect(terminalMock.sendResize).toHaveBeenCalledWith(120, 30);
        expect(terminalMock.focus).toHaveBeenCalledTimes(1);

        act(() => {
            firstMount.unmount();
        });

        render(<TerminalView sessionId={11} />);

        act(() => {
            vi.advanceTimersByTime(60);
        });

        expect(terminalMock.fit).toHaveBeenCalledTimes(2);
        expect(terminalMock.focus).toHaveBeenCalledTimes(2);
    });
});