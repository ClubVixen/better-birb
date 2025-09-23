type TagSearchProviders = 'none' | 'artconomy' | 'e621';
export interface Settings {
    advertise: boolean;
    emptyQueueOnFailedPost: boolean;
    postRetries: number;
    openOnLogin: boolean;
    openWindowOnStartup: boolean;
    useHardwareAcceleration: boolean;
    maxPNGSizeCompression: number;
    maxPNGSizeCompressionWithAlpha: number;
    maxJPEGQualityCompression: number;
    maxJPEGSizeCompression: number;
    silentNotification: boolean;
    defaultTagSearchProvider: TagSearchProviders;
    proxy: string;
    quitOnClose: boolean;
    titleGeneratorUrl: string;
}
export {};