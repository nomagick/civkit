"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadFile = void 0;
const tslib_1 = require("tslib");
const stream_1 = require("stream");
const util_1 = require("util");
const node_fetch_1 = tslib_1.__importDefault(require("node-fetch"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const streamPipeline = util_1.promisify(stream_1.pipeline);
async function downloadFile(uri, dest) {
    const resp = await node_fetch_1.default(uri);
    if (!resp.ok) {
        throw new Error(`Unexpected response ${resp.statusText}`);
    }
    const file = fs_1.default.createWriteStream(dest);
    await streamPipeline(resp.body, file);
    return dest;
}
exports.downloadFile = downloadFile;
//# sourceMappingURL=download.js.map