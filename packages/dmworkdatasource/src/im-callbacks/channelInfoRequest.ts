import type { Channel, ChannelInfo } from "wukongimjssdk";

const RETRY_DELAYS_MS = [300, 1000];
const FAILURE_COOLDOWN_MS = 30_000;

function isRetryable(error: unknown): boolean {
    const value = error as { status?: number; normalized?: { httpStatus?: number }; retryable?: boolean } | undefined;
    if (value?.retryable === false) return false;
    const status = value?.normalized?.httpStatus ?? value?.status;
    return !status || status === 408 || status === 429 || status >= 500;
}

export class InvalidChannelInfoError extends Error {
    readonly retryable = false;
}

export function createChannelInfoRequest(
    load: (channel: Channel) => Promise<ChannelInfo>,
    captureContext: () => () => boolean,
) {
    const requests = new Map<string, {
        current: () => boolean;
        expiresAt: number;
        promise: Promise<ChannelInfo>;
    }>();

    return (channel: Channel): Promise<ChannelInfo> => {
        for (const [key, request] of requests) {
            if (!request.current() || request.expiresAt <= Date.now()) requests.delete(key);
        }
        const key = channel.getChannelKey();
        const existing = requests.get(key);
        if (existing) return existing.promise;

        const current = captureContext();
        const assertCurrent = () => {
            if (!current()) throw new InvalidChannelInfoError("Channel info context expired");
        };
        const promise = (async () => {
            for (let attempt = 0; ; attempt++) {
                assertCurrent();
                try {
                    const result = await load(channel);
                    assertCurrent();
                    return result;
                } catch (error) {
                    assertCurrent();
                    if (!isRetryable(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
                    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
                }
            }
        })();
        const request = { current, expiresAt: Infinity, promise };
        requests.set(key, request);
        void request.promise.then(() => {
            if (requests.get(key) === request) requests.delete(key);
        }, () => {
            // Render-driven readers may ask again; a failure is not channel metadata.
            request.expiresAt = Date.now() + FAILURE_COOLDOWN_MS;
        });
        return request.promise;
    };
}
