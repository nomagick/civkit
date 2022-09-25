import 'reflect-metadata';
import { ParamValidationError, ApplicationError } from './errors';
import { AsyncService } from '../lib/async-service';
import { assignMeta, extractMeta } from './meta';
import { AutoCastable, AutoCastingError } from '../lib/auto-castable';

export const RPC_CALL_ENVIROMENT = Symbol('RPCEnv');

export class RPCHost extends AsyncService {
    setResultMeta<T extends object, P extends object>(target: T, metaToSet: P) {
        assignMeta(target, metaToSet);

        return target;
    }

    getResultMeta(target: object) {
        return extractMeta(target);
    }
}

export class Dto<T = any> extends AutoCastable {
    protected [RPC_CALL_ENVIROMENT]?: T;

    static override from(input: object): any {
        try {
            const r = super.from(input) as Dto<unknown>;

            if (input.hasOwnProperty(RPC_CALL_ENVIROMENT)) {
                r[RPC_CALL_ENVIROMENT] = (input as any)[RPC_CALL_ENVIROMENT];
            }

            return r;
        } catch (err) {
            if (err instanceof ApplicationError) {
                throw err;
            }
            if (err instanceof AutoCastingError) {
                throw new ParamValidationError({ ...err, err });
            }

            throw err;
        }
    }
}

export const RPCParam = Dto;
