import { perNextTick } from '../decorators/per-tick';
import { TrieNode } from '../utils/trie';

export type RouteKey = `:${string}` | `::${string}` | string;

interface RouteVec<D = unknown> {

    matchAnyAsProp?: string;
    matchRest?: boolean;

    data?: D[];

}

export class TrieRouter<D = unknown> {

    delimiter = '/';

    root = new TrieNode<RouteKey, RouteVec<D>>('', {});

    register(inputRoute: string | RouteKey[], data: D) {
        const route = typeof inputRoute === 'string' ? this.stringToArrayRoute(inputRoute) : inputRoute;
        const node = this.root.insert(...route);
        node.payload ??= {};
        node.payload.data ??= [];
        node.payload.data.push(data);

        this.fillRouteVecRoutine();

        return node;
    }

    @perNextTick()
    fillRouteVecRoutine() {
        const matchAnyNodes = [];
        for (const node of this.root.traverse()) {
            const key = node.key;
            node.payload ??= {};
            const data = node.payload as RouteVec<D>;
            if (key.startsWith('::')) {
                data.matchAnyAsProp = key.slice(2);
                data.matchRest = true;
                matchAnyNodes.push(node);
            } else if (key.startsWith(':')) {
                data.matchAnyAsProp = key.slice(1);
                matchAnyNodes.push(node);
            }
        }
        for (const node of matchAnyNodes) {
            const altNode = node.parent?.seek('')?.[0];
            const tgt = altNode?.insert(node.key);
            if (tgt) {
                tgt.payload = node.payload;
            }
        }
    }

    protected stringToArrayRoute(route: string): RouteKey[] {
        const orig = route.split(this.delimiter);

        if (orig.length <= 1) {
            return orig;
        }

        const head = orig[0];
        const last = orig[orig.length - 1];
        const middle = orig.slice(1, orig.length - 1);

        if (head === '') {
            return [head, ...middle, last];
        }

        return ['', head, ...middle, last];
    }

    match(
        inputRoute: string | RouteKey[],
        inputPtr: TrieNode<RouteKey, RouteVec<D>> = this.root,
        props: Record<string, unknown> = {}
    ): [D, Record<string, unknown>][] {
        const route = typeof inputRoute === 'string' ? this.stringToArrayRoute(inputRoute) : inputRoute;
        let ptr: TrieNode<RouteKey, RouteVec<D>> = inputPtr;

        let stack = route;

        [ptr, stack] = ptr.seek(...stack);

        if (stack.length === 0) {
            return ptr.payload?.data ? ptr.payload?.data.map((x) => [x, props]) : [];
        }

        const nextSteps: Array<[TrieNode<RouteKey, RouteVec<D>>, Record<string, unknown>]> = [];
        const matchRests: Array<[D, Record<string, unknown>]> = [];

        for (const v of ptr.children.values()) {
            if (!v.payload?.matchAnyAsProp) {
                continue;
            }
            if (v.payload?.matchRest) {
                if (v.payload?.data) {
                    const nextProps = { ...props, [v.payload.matchAnyAsProp]: decodeURIComponent(stack.join(this.delimiter)) };
                    for (const x of v.payload.data) {
                        matchRests.push([x, nextProps]);
                    }
                }

                continue;
            }

            nextSteps.push([v, { ...props, [v.payload.matchAnyAsProp]: decodeURIComponent(stack[0]) }]);
        }

        return nextSteps.flatMap(([node, props]) => this.match(stack.slice(1), node, props)).concat(matchRests);
    }


}
