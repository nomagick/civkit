import { AsyncService } from "./async-service";
import { LoggerInterface } from "./logger";


export abstract class AbstractEventDispatch extends AsyncService {
    abstract logger: LoggerInterface;

    override async init() {
        await this.dependencyReady();

        this.emit('ready');
    }

    dispatch(event: string, ...args: any[]) {
        this.emit(`dispatch-${event}`, ...args);
    }

    handle(event: string, handler: (...args: any[]) => void) {
        this.on(`dispatch-${event}`, handler);
    }

    handleOnce(event: string, handler: (...args: any[]) => void) {
        this.once(`dispatch-${event}`, handler);
    }

    dismiss(event: string, handler: (...args: any[]) => void) {
        this.off(`dispatch-${event}`, handler);
    }

}
