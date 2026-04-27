export {};

declare global {
  interface Window {
    electronAPI?: {
      isDesktop: boolean;
      platform: string;
      openInVsCode: (targetPath: string) => Promise<void>;
      isFullscreen: () => Promise<boolean>;
      setFullscreen: (value: boolean) => Promise<boolean>;
      toggleFullscreen: () => Promise<boolean>;
      onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
    };
  }
}
