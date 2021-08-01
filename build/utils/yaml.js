"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadYamlBase64Text = exports.loadYamlText = exports.loadYamlFile = void 0;
const tslib_1 = require("tslib");
const fs_1 = require("fs");
const util_1 = require("util");
const js_yaml_1 = tslib_1.__importDefault(require("js-yaml"));
const pReadfile = util_1.promisify(fs_1.readFile);
async function loadYamlFile(path) {
    const fContent = await pReadfile(path, { encoding: 'utf-8' });
    return js_yaml_1.default.safeLoad(fContent);
}
exports.loadYamlFile = loadYamlFile;
function loadYamlText(text) {
    return js_yaml_1.default.safeLoad(text);
}
exports.loadYamlText = loadYamlText;
function loadYamlBase64Text(text) {
    return js_yaml_1.default.safeLoad(Buffer.from(text, 'base64').toString('utf-8'));
}
exports.loadYamlBase64Text = loadYamlBase64Text;
//# sourceMappingURL=yaml.js.map