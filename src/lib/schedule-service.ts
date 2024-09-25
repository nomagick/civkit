import type { container as DIContainer } from 'tsyringe';

import nodeSchedule, {
    RecurrenceRule, RecurrenceSpecDateRange, RecurrenceSpecObjLit,
    JobCallback
} from 'node-schedule';
import { AsyncService } from './async-service';
import { LoggerInterface } from './logger';

export type ScheduleRule = RecurrenceRule | RecurrenceSpecDateRange | RecurrenceSpecObjLit | Date | string;

export abstract class AbstractScheduleService extends AsyncService {
    private __tick: number = 0;

    abstract container: typeof DIContainer;
    protected abstract logger: LoggerInterface;

    jobs: Map<string, nodeSchedule.Job> = new Map();

    constructor(...args: any[]) {
        super(...args);
        this.__tick = 1;
    }

    override init() {
        process.nextTick(() => {
            this.__tick++;
        });
    }

    schedule(name: string, schedule: ScheduleRule, func: JobCallback) {
        if (this.__tick === 1) {
            // Don't do the wrapping in tick 1.
            // Postpone it to tick 2.
            // Stuff could be not ready yet.
            setImmediate(() => {
                this.schedule(name, schedule, func);
            });
            return;
        }

        this.logger.info(`Scheduling ${name}: ${schedule}`, { name, schedule });

        const job = nodeSchedule.scheduleJob(name, schedule, func);

        if (this.jobs.has(name)) {
            this.logger.error(`Job name conflict: ${name}`, { name });
            throw new Error(`Job name conflict: ${name}`);
        }

        this.jobs.set(name, job);

        job.once('canceled', () => {
            this.jobs.delete(name);
            this.logger.info(`Scheduled job cancelled: ${name}`, { name, schedule });
        });

        job.on('scheduled', () => {
            this.logger.info(`Scheduled job running: ${name}`, { name, schedule });
        });

        job.on('error', (err) => {
            this.logger.warn(`Scheduled job failed: ${name}`, { name, schedule, err });
        });

        return job;
    }

    reschedule(name: string, schedule: ScheduleRule) {
        if (!this.jobs.has(name)) {
            throw new Error(`No such job: ${name}`);
        }

        const newJob = nodeSchedule.rescheduleJob(name, schedule);

        this.jobs.set(name, newJob);

        return newJob;
    }

    cancel(name: string) {
        if (!this.jobs.has(name)) {
            return;
        }

        this.jobs.delete(name);

        return nodeSchedule.cancelJob(name);
    }

    Recurred(spec: ScheduleRule, options?: {
        name?: string;
    }) {
        const RecurredPropDecorator = (tgt: any, methodName: string) => {
            setImmediate(() => {
                const x = this.container.resolve(tgt.constructor);

                const func = Reflect.get(tgt, methodName).bind(x);

                this.schedule(options?.name || methodName, spec, func);
            });
        };

        return RecurredPropDecorator;
    }

    decorators() {
        const Recurred = this.Recurred.bind(this);

        return { Recurred };
    }

}
