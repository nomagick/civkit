import _ from "lodash";
import { AsyncService } from "./async-service";

export abstract class AbstractSignalBus extends AsyncService {
    handlers = new Map<string, Function[]>();

    override async init() {
        await this.dependencyReady();

        this.emit('ready');
    }

    dispatch(event: string, ...args: any[]) {
        this.emit(`sig-${event}`, ...args);
        const handlers = this.__prepare(event);

        const promises = handlers.map(async (x) => {
            try {
                return [null, await x.call(undefined, ...args)] as [null | unknown, null | unknown];
            } catch (err) {
                return [err, null] as [null | unknown, null | unknown];
            }
        });

        return Promise.allSettled(promises);
    }

    async dispatchSerial(event: string, ...args: any[]) {
        this.emit(`sig-${event}`, ...args);
        const handlers = this.__prepare(event);
        const results: [null | unknown, null | unknown][] = [];

        for (const handler of handlers) {
            try {
                results.push([null, await handler.call(undefined, ...args)]);
            } catch (err) {
                results.push([err, null]);
            }
        }

        return results;
    }

    async dispatchReverse(event: string, ...args: any[]) {
        this.emit(`sig-${event}`, ...args);
        const handlers = this.__prepare(event);

        const promises = handlers.reverse().map(async (x) => {
            try {
                return [null, await x.call(undefined, ...args)] as [null | unknown, null | unknown];
            } catch (err) {
                return [err, null] as [null | unknown, null | unknown];
            }
        });

        return Promise.allSettled(promises);
    }

    async dispatchReverseSerial(event: string, ...args: any[]) {
        this.emit(`sig-${event}`, ...args);
        const handlers = this.__prepare(event);
        const results: [null | unknown, null | unknown][] = [];

        for (const handler of handlers.reverse()) {
            try {
                results.push([null, await handler.call(undefined, ...args)]);
            } catch (err) {
                results.push([err, null]);
            }
        }

        return results;
    }

    protected __prepare(event: string) {
        if (this.handlers.has(event)) {
            return this.handlers.get(event)!;
        }

        const handlers = [] as Function[];
        this.handlers.set(event, handlers);

        return handlers;
    }

    handle(event: string, handler: (...args: any[]) => void) {
        this.__prepare(event).push(handler);
    }

    dismiss(event: string, handler: (...args: any[]) => void) {
        const handlers = this.__prepare(event);

        if (handlers.includes(handler)) {
            _.pull(handlers, handler);
        }
    }

}
